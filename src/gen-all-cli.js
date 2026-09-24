#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {loadAllManifest,normalizeAllManifest,inventoryAll,collectComponent} from './gen-all.js';

const completeCLI=fileURLToPath(new URL('./complete-css-cli.js',import.meta.url));

async function runComplete({archive,component,output,provider,model,effort,batchSize}){
  const args=[completeCLI,'--input',archive,'--component',component,'--output',output,'--provider',provider,
    '--batch-size',String(batchSize)];
  if(model)args.push('--model',model);
  if(effort)args.push('--effort',effort);
  const exitCode=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,args,{stdio:'inherit'});
    child.once('error',reject);child.once('exit',(code,signal)=>signal?reject(new Error(`Génération interrompue : ${signal}`)):done(code));
  });
  if(exitCode!==0&&exitCode!==2)throw new Error(`css:complete a échoué (code ${exitCode}) ; voir ${output}/report.json`);
  const report=JSON.parse(await readFile(join(output,'report.json'),'utf8'));
  return {css:join(output,`${component}.css`),report,
    status:exitCode===2||report.angularCompilation?.moved?.length?'needs_review':'generated_unverified'};
}

try{
  const {values}=parseArgs({options:{pages:{type:'string'},inventory:{type:'string'},output:{type:'string'},
    mode:{type:'string'},complete:{type:'boolean'},provider:{type:'string'},model:{type:'string'},
    effort:{type:'string'},'batch-size':{type:'string'},only:{type:'string'},headed:{type:'boolean'},help:{type:'boolean'}}});
  if(values.help){
    console.log('Usage : npm run css:inventory -- --pages pages-all.json [--output artifacts/gen-all/DATE]\n'+
      '        npm run css:gen-all -- --pages pages-all.json [--only fbr-button,fho-header] [--complete --provider openai|claude]\n'+
      '        npm run css:gen-all -- --inventory artifacts/gen-all/DATE/inventory.json [--complete]\n'+
      'Sans --complete : inventaire, collecte et CSS local sûr uniquement. --complete appelle le CLI IA pour les règles ambiguës.');
    process.exit(0);
  }
  const mode=values.mode||'generate';
  if(!['inventory','generate'].includes(mode))throw new Error('--mode doit être inventory ou generate.');
  if(Boolean(values.pages)===Boolean(values.inventory))throw new Error('Fournir exactement un de --pages ou --inventory.');
  if(mode==='inventory'&&values.complete)throw new Error('--complete exige le mode generate.');
  const provider=values.provider||'openai';
  if(!['openai','claude'].includes(provider))throw new Error('--provider doit être openai ou claude.');
  if(provider==='claude'&&values.effort)throw new Error('--effort est propre à Codex.');
  const batchSize=values['batch-size']===undefined?20:Number(values['batch-size']);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>50)throw new Error('--batch-size doit être entre 1 et 50.');
  const only=values.only?new Set(values.only.split(',').map(s=>s.trim())):null;
  if(only&&[...only].some(s=>!/^[a-z][a-z0-9-]*$/.test(s)))throw new Error('--only doit contenir des noms de composants séparés par des virgules.');
  let manifest,inventory,output;
  if(values.pages){
    manifest=await loadAllManifest(values.pages);
    output=resolve(values.output||join('artifacts','gen-all',new Date().toISOString().replace(/[:.]/g,'-')));
    await mkdir(output,{recursive:true});
    inventory=await inventoryAll(manifest,{headed:values.headed});
    inventory.manifest=manifest;
    await writeFile(join(output,'inventory.json'),JSON.stringify(inventory,null,2));
  }else{
    const inventoryPath=resolve(values.inventory);
    inventory=JSON.parse(await readFile(inventoryPath,'utf8'));
    if(inventory.format!=='chromatic-component-inventory-v1'||!inventory.manifest)throw new Error('Inventaire incompatible.');
    manifest=normalizeAllManifest(inventory.manifest);
    output=resolve(values.output||dirname(inventoryPath));
    await mkdir(output,{recursive:true});
    if(join(output,'inventory.json')!==inventoryPath)
      await writeFile(join(output,'inventory.json'),JSON.stringify(inventory,null,2));
  }
  console.log(`${inventory.components.length} composants trouvés sur ${inventory.pages.filter(p=>p.status==='captured').length}/${inventory.pages.length} pages. Inventaire : ${join(output,'inventory.json')}`);
  if(inventory.status!=='complete')throw new Error('Inventaire incomplet : corriger les pages en échec avant la génération.');
  if(mode==='inventory')process.exit(0);
  const components=inventory.components.filter(c=>!only||only.has(c.tag));
  if(only){const missing=[...only].filter(tag=>!inventory.components.some(c=>c.tag===tag));if(missing.length)throw new Error(`Composants absents de l’inventaire : ${missing.join(', ')}`);}
  if(!components.length)throw new Error('Aucun composant à générer.');
  const summary={format:'chromatic-gen-all-report-v1',inventory:join(output,'inventory.json'),
    mode:values.complete?'complete':'local',provider:values.complete?provider:null,components:[],
    note:'Couverture limitée aux pages et états observés. generated_unverified ne prouve pas la fidélité visuelle.'};
  for(let index=0;index<components.length;index++){
    const component=components[index],row={component:component.tag,pages:component.pages.length,instances:component.instances,status:'failed'};
    console.log(`[${index+1}/${components.length}] ${component.tag} : ${row.pages} page(s), ${row.instances} instance(s).`);
    try{
      const local=await collectComponent(manifest,component,{headed:values.headed,
        outputRoot:join(output,'components',component.tag,'collect')});
      row.archive=local.archive;row.localCSS=join(local.localPath,`${component.tag}.safe.css`);
      row.localRules=local.report.safe;row.ambiguousRules=local.report.ambiguous;
      row.status='local';
      if(values.complete){
        const completed=await runComplete({archive:local.archive,component:component.tag,
          output:join(output,'components',component.tag,'complete'),provider,model:values.model,
          effort:values.effort,batchSize});
        row.css=completed.css;row.status=completed.status;row.usage=completed.report.usage;
        row.globalCSS=completed.report.angularCompilation?.moved?.length?join(output,'components',component.tag,'complete',`${component.tag}.context.css`):null;
      }
    }catch(error){row.status='failed';row.error=error.message;console.error(`${component.tag} : ${error.message}`);}
    summary.components.push(row);
    await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2));
  }
  const usage=summary.components.reduce((total,row)=>{
    for(const [key,value] of Object.entries(row.usage||{}))if(typeof value==='number')total[key]=(total[key]||0)+value;
    return total;
  },{});
  summary.usage=usage;
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2));
  console.log(`Rapport : ${join(output,'summary.json')} (${summary.components.filter(c=>c.status==='failed').length} échec(s)).`);
  if(summary.components.some(c=>c.status==='failed'))process.exitCode=1;
  else if(summary.components.some(c=>c.status==='needs_review'))process.exitCode=2;
}catch(error){console.error(error.message);process.exitCode=1;}
