import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

function declarationSignatures(css) {
  try {
    const root=postcss.parse(`x{${css}}`),values=[];
    root.walkDecls(d=>values.push(`${d.prop.trim().toLowerCase()}:${d.value.trim()}${d.important?' !important':''}`));
    return values;
  } catch { return []; }
}

export function validateResult(result,input) {
  const errors=[],review=[];
  if(!result||typeof result.css!=='string'||!result.css.trim())return {errors:['CSS vide ou absent.'],review};
  for(const key of ['unresolved','assumptions','externalDependencies'])if(!Array.isArray(result[key])||result[key].some(x=>typeof x!=='string'))errors.push(`${key} invalide.`);
  if(!Array.isArray(result.coverage))errors.push('coverage absent.');
  const ids=new Set(input.definitions.map(d=>d.id)),required=new Set(input.completeness?.requiredDefinitionIDs||[]),seen=new Set(),converted=new Set();
  for(const entry of Array.isArray(result.coverage)?result.coverage:[]){
    if(!entry||!Array.isArray(entry.sourceIds)||typeof entry.reason!=='string'||!entry.reason.trim()||!['converted','dependency','not_applicable','external_ionic','unresolved'].includes(entry.disposition)){errors.push('Entrée de couverture invalide.');continue;}
    for(const id of entry.sourceIds){if(!ids.has(id))errors.push(`Source inventée : ${id}`);if(seen.has(id))errors.push(`Source classée deux fois : ${id}`);seen.add(id);if(entry.disposition==='converted')converted.add(id);if(required.has(id)&&entry.disposition!=='converted')errors.push(`Règle obligatoire non convertie : ${id} (${entry.disposition}).`);}
    if(entry.disposition==='unresolved')errors.push(`Couverture non résolue interdite : ${entry.reason}`);
    if(entry.disposition==='external_ionic'&&!input.coverage.ionicProvenanceIdentified)review.push('Exclusion Ionic sans provenance confirmée : '+entry.reason);
  }
  const missing=[...ids].filter(id=>!seen.has(id));if(missing.length)errors.push(`Sources non classées : ${missing.join(', ')}`);
  if(/```/.test(result.css))errors.push('Balises Markdown interdites dans le CSS.');
  try {
    const root=postcss.parse(result.css);
    const outputDeclarations=new Set();
    let styleRules=0;
    root.walkAtRules(rule=>{if(['import','use','forward','mixin','include','extend','function'].includes(rule.name.toLowerCase()))errors.push(`@${rule.name} interdit.`);});
    root.walkDecls(d=>{if(d.parent.type==='root')errors.push('Déclaration hors règle CSS.');if(d.prop.startsWith('$')||/#\{|\$[\w-]+/.test(d.value))errors.push('Syntaxe Sass détectée.');outputDeclarations.add(`${d.prop.trim().toLowerCase()}:${d.value.trim()}${d.important?' !important':''}`);});
    root.walkRules(rule=>{
      let parent=rule.parent;let keyframe=false;
      while(parent){if(parent.type==='rule')errors.push('Les sélecteurs imbriqués doivent être explicités.');if(parent.type==='atrule'&&/^(?:-webkit-)?keyframes$/i.test(parent.name))keyframe=true;parent=parent.parent;}
      if(keyframe)return;
      styleRules++;
      try {
        selectorParser(selectors=>selectors.each(branch=>{
          const first=branch.nodes.find(n=>n.type!=='comment');
          if(first?.type!=='pseudo'||![':host',':host-context'].includes(first.value))errors.push(`Sélecteur non encapsulé : ${branch}`);
          if(!branch.nodes.some(n=>n.type==='pseudo'&&n.value===':host'))errors.push(`Ancre :host absente : ${branch}`);
          branch.walk(n=>{
            if(n.type==='tag'&&n.value.toLowerCase()===input.component.toLowerCase())errors.push('Le tag hôte subsiste dans un sélecteur.');
            if(n.type==='attribute'&&/^_ng(?:host|content)-/.test(n.attribute))errors.push('Attribut Angular généré subsistant.');
            if(n.type==='nesting')errors.push('Sélecteur & interdit.');
          });
        })).processSync(rule.selector);
      }catch{errors.push(`Sélecteur CSS invalide : ${rule.selector}`);}
    });
    if(!styleRules)errors.push('Aucune règle de style CSS.');
    for(const definition of input.definitions.filter(d=>required.has(d.id)))for(const declaration of declarationSignatures(definition.css||''))
      if(!outputDeclarations.has(declaration))errors.push(`Déclaration obligatoire absente (${definition.id}) : ${declaration}`);
  }catch(e){errors.push(`Syntaxe CSS invalide : ${e.reason||e.message}`);}
  if(Array.isArray(result.unresolved)&&result.unresolved.length)errors.push(...result.unresolved.map(x=>`Résultat déclaré incomplet : ${x}`));
  if(input.coverage.missingReferenceWidths.length)review.push('Largeurs non observées : '+input.coverage.missingReferenceWidths.join(', '));
  review.push(...input.captures.flatMap(c=>c.warnings));
  return {errors:[...new Set(errors)],review:[...new Set(review)]};
}
