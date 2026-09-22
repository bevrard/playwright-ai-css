import {compact} from '../exporter.js';
import parser from 'postcss-selector-parser';
const strength={context:0,dependency:1,required:2};
const referencedVariables=css=>[...(css||'').matchAll(/var\(\s*(--[\w-]+)/g)].map(match=>match[1]);
const declaredVariables=css=>[...(css||'').matchAll(/(?:^|;)\s*(--[\w-]+)\s*:/g)].map(match=>match[1]);

function selectorRelation(selector,component){
  const result={targetsComponent:false,clearlyExternal:false};
  try{
    const root=parser().astSync(selector);
    root.each(branch=>{
      const relevantTags=[];
      branch.walkTags(tag=>{
        // A component mentioned only as a predicate does not receive the rule:
        // `.row:has(fbr-button)` styles `.row`, not `fbr-button`.
        let parent=tag.parent,predicate=false;
        while(parent&&parent!==branch){
          if(parent.type==='pseudo'&&[':has',':not'].includes(parent.value)){predicate=true;break;}
          parent=parent.parent;
        }
        if(!predicate)relevantTags.push(tag.value.toLowerCase());
      });
      if(relevantTags.includes(component))result.targetsComponent=true;
      if(relevantTags.some(tag=>tag.includes('-')&&tag!==component))result.clearlyExternal=true;
    });
  }catch{}
  return result;
}

export function buildInput(archive,requestedComponent) {
  if(!Array.isArray(archive.dictionary)||!archive.captures?.length)throw new Error('Archive de collecte vide ou incompatible.');
  const tags=[...new Set(archive.captures.flatMap(c=>c.targets.map(t=>c.nodes.find(n=>n.id===t.node)?.tag)).filter(Boolean))];
  const component=requestedComponent||(tags.length===1?tags[0]:null);
  if(!component||!tags.includes(component))throw new Error(`Choisir --component parmi : ${tags.join(', ')}`);
  if(!/^[a-z][a-z0-9-]*$/.test(component))throw new Error('Nom de composant invalide.');
  const selected=archive.captures.filter(c=>c.targets.some(t=>c.nodes.find(n=>n.id===t.node)?.tag===component));
  const context=compact({...archive,captures:selected});
  const definitions=[],definitionIDs=new Map(),definitionIndexes=new Map(),attributes=[],attributeIDs=new Map();
  const internAttrs=ref=>{
    const raw=archive.dictionary[ref];if(!attributeIDs.has(raw)){attributeIDs.set(raw,attributes.length);attributes.push(JSON.parse(raw));}return attributeIDs.get(raw);
  };
  const captures=context.captures.map((c,index)=>{
    const original=selected[index];
    const targetNodes=new Set(c.targets.filter(t=>c.nodes.find(n=>n.id===t.node)?.tag===component).map(t=>t.node));
    const ownedNodes=new Set(targetNodes),queue=[...targetNodes];
    while(queue.length){const id=queue.shift(),node=c.nodes.find(n=>n.id===id);for(const child of node?.children||[])if(!ownedNodes.has(child)){ownedNodes.add(child);queue.push(child);}}
    const rules=c.rules.map(r=>{
      // Only structural descriptions are shared. Occurrences are retained in order.
      const definition={type:r.type,kind:r.kind};
      for(const key of ['selector','css','header'])if(r[key+'Ref']!==undefined)definition[key]=archive.dictionary[r[key+'Ref']];
      for(const key of ['importMedia','importSupports','importLayer'])if(r[key]!==undefined)definition[key]=r[key];
      const candidateNodes=(r.candidates||[]).flatMap(candidate=>candidate.nodes||[]);
      const relation=selectorRelation(definition.selector||'',component);
      const candidateReasons=new Set((r.candidates||[]).map(candidate=>candidate.reason));
      const required=r.kind==='CSSStyleRule'&&(
        candidateNodes.some(id=>ownedNodes.has(id))||
        candidateReasons.has('angular-scope')||
        relation.targetsComponent||
        ((candidateReasons.has('uncertain-selector')||candidateReasons.has('unsupported-selector'))&&!relation.clearlyExternal)
      );
      const role=required?'required':r.kind==='CSSStyleRule'?'context':'dependency';
      const key=JSON.stringify(definition);
      if(!definitionIDs.has(key)){
        definitionIDs.set(key,`r${definitions.length}`);
        const item={id:`r${definitions.length}`,...definition,role};
        definitionIndexes.set(item.id,definitions.length);definitions.push(item);
      } else {
        const known=definitions[definitionIndexes.get(definitionIDs.get(key))];
        if(strength[role]>strength[known.role])known.role=role;
      }
      return [r.id,definitionIDs.get(key),r.sheet,r.parent,r.position,r.importedSheet??null];
    });
    return {id:c.id,url:c.url,label:c.label,viewport:c.viewport,environment:c.environment,
      analysisVersion:original.analysisVersion||'legacy',
      targets:c.targets.filter(t=>c.nodes.find(n=>n.id===t.node)?.tag===component),
      nodes:c.nodes.map(n=>[n.id,n.tag,internAttrs(n.attrsRef),n.parent,n.children,n.childrenComplete,!!n.boundary,
        Object.entries(n.states||{}).filter(([,v])=>v!==false),n.rect||null,n.childElementCount??null,n.childNodeCount??null,n.text??null]),
      angularHosts:c.angularHosts,sheets:c.sheets,rules,warnings:c.warnings,
      omittedRuleCount:c.omittedRuleIDs.length,
      // A small reference of observed dimensions, not thousands of computed properties.
      measurements:original.nodes.filter(n=>n.computedRef!==undefined&&['button',component].includes(n.tag)).map(n=>{
        const computed=JSON.parse(archive.dictionary[n.computedRef]);
        const computedVariables=Object.fromEntries(Object.entries(computed).filter(([k,v])=>k.startsWith('--')&&v?.trim()));
        return {node:n.id,...Object.fromEntries(['display','height','width','font-size','line-height','color','background-color'].map(k=>[k,computed[k]])),computedVariables};
      })};
  });
  const widths=[...new Set(captures.map(c=>c.viewport.width))].sort((a,b)=>a-b);
  const requiredDefinitionIDs=definitions.filter(d=>d.role==='required').map(d=>d.id);
  // Only values reachable from required CSS are useful. Resolve references through
  // custom-property declarations, then intern identical maps across nodes/pages.
  const neededVariables=new Set(definitions.filter(d=>d.role==='required').flatMap(d=>referencedVariables(d.css)));
  let changed=true;
  while(changed){changed=false;for(const definition of definitions){
    const declared=declaredVariables(definition.css);if(!declared.some(name=>neededVariables.has(name)))continue;
    for(const name of referencedVariables(definition.css))if(!neededVariables.has(name)){neededVariables.add(name);changed=true;}
  }}
  const variableSets=[],variableSetIDs=new Map();
  for(const capture of captures)for(const measurement of capture.measurements){
    const filtered=Object.fromEntries(Object.entries(measurement.computedVariables).filter(([name])=>neededVariables.has(name)));
    delete measurement.computedVariables;
    const key=JSON.stringify(filtered);
    if(!variableSetIDs.has(key)){variableSetIDs.set(key,variableSets.length);variableSets.push(filtered);}
    measurement.variableSet=variableSetIDs.get(key);
  }
  const requiredDeclarationCount=definitions.filter(d=>d.role==='required').reduce((count,d)=>count+(d.css?.split(';').filter(Boolean).length||0),0);
  return {format:'css-regeneration-input-v2',component,
    schema:{rules:'[sourceRuleId, definitionId, sheetId, parentSourceRuleId, position, importedSheetId]. Garder CHAQUE occurrence et son ordre.',
      nodes:'[id, tag, attributesIndex, parentId, orderedChildrenIds, childrenComplete, boundary, nonFalseStates, rect, childElementCount, childNodeCount, directTextOrNull]. Les autres états observés valent false.',
      states:['hover','active','focus','focus-visible','focus-within','disabled','checked','indeterminate'],
      definitionIDs:'coverage doit classer chaque definition.id une fois. Les définitions partagées ne suppriment aucune occurrence.',
      variableSets:'Les mesures référencent variableSets par index. Seules les variables atteignables depuis les règles required sont incluses.',
      roles:'required = règle de style à convertir obligatoirement ; dependency = ressource/groupe à conserver si utilisé ; context = contexte extérieur probablement non ciblé.'},
    coverage:{observedWidths:widths,missingReferenceWidths:[375,767,1024,1199,1280,1440].filter(w=>!widths.includes(w)),
      ionicProvenanceIdentified:captures.some(c=>c.sheets.some(s=>s.ionic)),
      note:'Données candidates, pas preuve d’exhaustivité. Les règles écartées et valeurs calculées complètes restent dans l’archive locale, non accessible au modèle.'},
    completeness:{policy:'conservative-superset',requiredDefinitionIDs,
      requiredDeclarationCount,
      rule:'Chaque définition required doit être classée converted et toutes ses déclarations doivent subsister textuellement dans css. Les doublons sont préférables aux omissions.'},
    limitations:archive.limitations,attributes,variableSets,definitions,captures};
}
