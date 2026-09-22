import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compact } from './exporter.js';

/** Reconstruction de lecture : conserve les IDs, groupes, imports et occurrences. */
export function renderCSS(capture,dictionary,selectedIDs=null) {
  const text=(r,key)=>dictionary[r[key+'Ref']]||'';
  const comment=value=>String(value).replaceAll('*/','* /');
  const block=(header,body)=>`${header} {\n${body}\n}\n`;
  const byParent=new Map();
  for(const r of capture.rules){const key=`${r.sheet}:${r.parent??'root'}`;if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(r);}
  function rules(sheetID,parent=null){
    return (byParent.get(`${sheetID}:${parent??'root'}`)||[]).map(r=>{
      if(selectedIDs&&!selectedIDs.has(r.id))return '';
      const prefix=`/* rule ${r.id}; sheet ${r.sheet}; position ${r.position} */\n`;
      if(r.type===3){
        const imported=capture.sheets[r.importedSheet];
        if(!imported||imported.error)return prefix+text(r,'css')+'\n';
        let body=sheet(imported,false);
        if(r.importMedia)body=block(`@media ${r.importMedia}`,body);
        if(r.importSupports)body=block(`@supports (${r.importSupports})`,body);
        if(r.importLayer!==null&&r.importLayer!==undefined)body=block(`@layer ${r.importLayer}`,body);
        return prefix+body;
      }
      if(r.type===1)return prefix+block(text(r,'selector'),text(r,'css')+'\n'+rules(sheetID,r.id));
      if(r.headerRef!==undefined)return prefix+block(text(r,'header'),rules(sheetID,r.id));
      return prefix+text(r,'css')+'\n';
    }).join('\n');
  }
  function sheet(s,applyMedia=true){
    const heading=`/* sheet ${s.id}; baseURL: ${comment(s.baseURL)}; disabled: ${!!s.disabled} */\n`;
    if(s.error)return heading+`/* INACCESSIBLE: ${comment(s.error)} */\n`;
    // Les feuilles désactivées restent dans source.css comme données, marquées explicitement.
    let body=rules(s.id);
    if(applyMedia&&s.media)body=block(`@media ${s.media}`,body);
    return heading+body;
  }
  return '/* SOURCE POUR ANALYSE, PAS CSS FINAL À COLLER.\nLes URL relatives gardent la baseURL de leur feuille. Les feuilles désactivées sont annotées.\nLes styles globaux, attributs Angular et sélecteurs d’origine sont conservés. */\n\n'+
    capture.sheets.filter(s=>s.parentImport===null).map(s=>sheet(s)).join('\n');
}
export async function writeReadable(output,bundle,capture) {
  const directory=`page-${String(capture.id+1).padStart(3,'0')}`;
  const folder=join(output,directory);await mkdir(folder,{recursive:true});
  const decode=ref=>ref===undefined?undefined:JSON.parse(bundle.dictionary[ref]);
  const nodes=capture.nodes.map(n=>{const {attrsRef,computedRef,pseudosRef,...rest}=n;return {...rest,attrs:decode(attrsRef)};});
  const dom={url:capture.url,label:capture.label,viewport:capture.viewport,selection:capture.selection,
    targets:capture.targets,nodes,angularHosts:capture.angularHosts,warnings:capture.warnings,
    limitations:bundle.limitations,
    note:'Graphe DOM observé : id/parent/children décrivent les relations. childrenComplete=false indique une frontière ou un sous-arbre omis. Les textes dépendent de includeText.'};
  const computed=capture.nodes.filter(n=>n.computedRef!==undefined).map(n=>({node:n.id,computed:decode(n.computedRef),pseudos:decode(n.pseudosRef)}));
  const candidate=compact({...bundle,captures:[capture]}).captures[0];
  const selectedIDs=new Set(candidate.rules.map(r=>r.id));
  await Promise.all([
    writeFile(join(folder,'dom.json'),JSON.stringify(dom,null,2)),
    writeFile(join(folder,'computed.json'),JSON.stringify(computed)),
    writeFile(join(folder,'source.css'),renderCSS(capture,bundle.dictionary)),
    writeFile(join(folder,'candidates.css'),'/* FILTRAGE HEURISTIQUE : consulter source.css pour les règles omises. */\n'+renderCSS(capture,bundle.dictionary,selectedIDs)),
    writeFile(join(folder,'sources.json'),JSON.stringify({url:capture.url,sheets:capture.sheets,omittedRuleIDs:candidate.omittedRuleIDs},null,2)),
  ]);
  return directory;
}
