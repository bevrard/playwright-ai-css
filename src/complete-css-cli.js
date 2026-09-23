#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {locateArchive} from './ai/run.js';
import {buildInput} from './ai/input.js';
import {buildCLIRequest,generateCLI} from './ai/cli-provider.js';
import {validateResult} from './ai/validate.js';
import {prepareLocalCSS} from './local-css.js';
import {separateAngularCSS} from './angular-css.js';
import {reconcileAIResponses} from './ai/reconcile.js';

const prompt=`Convertis uniquement les définitions CSS fournies vers le composant Angular indiqué.
Chaque sélecteur de style doit commencer par :host ou :host-context(...) et contenir l'ancre :host.
Chaque branche séparée par une virgule doit contenir littéralement le pseudo :host. :host-context(...) seul ne suffit jamais ; écris par exemple :host-context(.theme) :host .enfant.
Supprime les attributs _nghost-* et _ngcontent-* sans perdre les conditions, pseudo-classes, pseudo-éléments, combinatoires ni déclarations.
Conserve chaque déclaration textuellement, y compris !important. Une approximation conservatrice est préférable à une omission.
coverage doit contenir chaque identifiant fourni individuellement et exactement une fois. Les plages comme r1-r9 sont interdites.
Toutes les définitions sont obligatoires : disposition converted uniquement. unresolved doit être vide.
Réponds seulement avec le JSON conforme au schéma.`;

try{
  const {values}=parseArgs({options:{provider:{type:'string'},input:{type:'string'},component:{type:'string'},model:{type:'string'},effort:{type:'string'},output:{type:'string'},'batch-size':{type:'string'},'dry-run':{type:'boolean'}}});
  const provider=values.provider||'openai';
  if(!['openai','claude'].includes(provider))throw new Error('--provider doit être openai ou claude.');
  if(provider==='claude'&&values.effort)throw new Error('--effort est propre à Codex ; ne pas le fournir avec Claude.');
  const batchSize=values['batch-size']===undefined?20:Number(values['batch-size']);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>50)throw new Error('--batch-size doit être compris entre 1 et 50.');
  const model=values.model||(provider==='openai'?(process.env.CODEX_MODEL||'gpt-5.6-terra'):(process.env.CLAUDE_MODEL||null));
  const reasoningEffort=provider==='openai'?(values.effort||process.env.CODEX_REASONING_EFFORT||'medium'):null;
  const archivePath=await locateArchive(values.input),archive=JSON.parse(await readFile(archivePath,'utf8'));
  const input=buildInput(archive,values.component),local=prepareLocalCSS(input);
  const output=resolve(values.output||join(dirname(archivePath),'local-css',input.component,`complete-${new Date().toISOString().replace(/[:.]/g,'-')}`));
  const responses=[],usages=[],batches=[];
  for(let offset=0;offset<local.ambiguous.length;offset+=batchSize)batches.push(local.ambiguous.slice(offset,offset+batchSize));
  if(values['dry-run']){
    const sizes=batches.map((definitions,index)=>buildCLIRequest({provider,model,reasoningEffort,prompt,
      input:{format:'css-ambiguous-batch-v1',component:input.component,rule:'Chaque ID doit être écrit littéralement dans coverage ; aucune plage ou abréviation.',definitions},
      output:join(output,`batch-${String(index+1).padStart(3,'0')}`)}).stdin.length);
    console.log(`${input.component} : ${local.safe.length} règles locales, ${local.ambiguous.length} règles IA en ${batches.length} lots via ${provider}.\nTaille des requêtes : ${sizes.join(', ')} caractères (total ${sizes.reduce((sum,size)=>sum+size,0)}). Aucun appel IA.`);
    process.exit(0);
  }
  await mkdir(output,{recursive:true});
  for(let index=0;index<batches.length;index++){
    const definitions=batches[index],batchOutput=join(output,`batch-${String(index+1).padStart(3,'0')}`);await mkdir(batchOutput,{recursive:true});
    const batchInput={format:'css-ambiguous-batch-v1',component:input.component,
      rule:'Chaque ID doit être écrit littéralement dans coverage ; aucune plage ou abréviation.',definitions};
    const meta={provider,model,reasoningEffort,inputHash:createHash('sha256').update(JSON.stringify(batchInput)).digest('hex')};
    try{
      const savedResponse=JSON.parse(await readFile(join(batchOutput,'response.json'),'utf8'));
      const savedValidation=JSON.parse(await readFile(join(batchOutput,'validation.json'),'utf8'));
      let savedMeta;
      try{savedMeta=JSON.parse(await readFile(join(batchOutput,'batch-meta.json'),'utf8'));}
      catch{
        // Older OpenAI runs had no metadata. Reuse only after comparing their
        // exact input, and never for a Claude run.
        if(provider==='openai'&&model==='gpt-5.6-terra'&&reasoningEffort==='medium'){
          const oldInput=JSON.parse(await readFile(join(batchOutput,'input.json'),'utf8'));
          if(JSON.stringify(oldInput)===JSON.stringify(batchInput))savedMeta=meta;
        }
      }
      if(JSON.stringify(savedMeta)===JSON.stringify(meta)&&!savedValidation.errors?.length){
        await writeFile(join(batchOutput,'batch-meta.json'),JSON.stringify(meta,null,2));
        responses.push(savedResponse.result);usages.push(savedResponse.usage||{});console.log(`[${index+1}/${batches.length}] lot ${provider} validé réutilisé.`);continue;
      }
    }catch{}
    const request=buildCLIRequest({provider,model,reasoningEffort,prompt,input:batchInput,output:batchOutput});
    await writeFile(join(batchOutput,'request.txt'),request.stdin);await writeFile(join(batchOutput,'input.json'),JSON.stringify(batchInput,null,2));
    const response=await generateCLI(request,{timeout:1200000});
    const validation=validateResult(response.result,{component:input.component,definitions,
      completeness:{requiredDefinitionIDs:definitions.map(d=>d.id)},coverage:{ionicProvenanceIdentified:false,missingReferenceWidths:[]},captures:[]});
    await writeFile(join(batchOutput,'response.json'),JSON.stringify(response,null,2));
    await writeFile(join(batchOutput,'validation.json'),JSON.stringify(validation,null,2));
    if(validation.errors.length)throw new Error(`Lot ${index+1}/${batches.length} invalide : ${validation.errors.slice(0,5).join(' | ')}`);
    await writeFile(join(batchOutput,'batch-meta.json'),JSON.stringify(meta,null,2));
    responses.push(response.result);usages.push(response.usage||{});console.log(`[${index+1}/${batches.length}] ${definitions.length} règles ambiguës converties avec ${model||'Claude par défaut'}.`);
  }
  const requiredCoverage=[{sourceIds:local.safe.map(item=>item.id),disposition:'converted',reason:'Conversion déterministe locale.'},
    ...responses.flatMap(response=>response.coverage)];
  const context=input.definitions.filter(d=>d.role==='context').map(d=>d.id),dependencies=input.definitions.filter(d=>d.role==='dependency').map(d=>d.id);
  const reconciliation=reconcileAIResponses({input,archive,ambiguous:local.ambiguous,responses});
  const result={css:local.css+'\n'+reconciliation.css.trim()+'\n',
    coverage:[...requiredCoverage,
      ...(context.length?[{sourceIds:context,disposition:'not_applicable',reason:'Contexte extérieur conservé dans l’archive, hors CSS du composant.'}]:[]),
      ...(dependencies.length?[{sourceIds:dependencies,disposition:'dependency',reason:'Dépendances et groupes conditionnels conservés avec leurs règles utilisatrices.'}]:[])],
    unresolved:[],assumptions:responses.flatMap(response=>response.assumptions),externalDependencies:[...new Set(responses.flatMap(response=>response.externalDependencies))]};
  const usage=usages.reduce((total,current)=>{for(const [key,value] of Object.entries(current))if(typeof value==='number')total[key]=(total[key]||0)+value;return total;},{});
  const separated=await separateAngularCSS(result.css,input.component);
  const validation=validateResult(result,input),report={provider,model,reasoningEffort,batchSize,batches:batches.length,usage,
    localRules:local.safe.length,aiRules:local.ambiguous.length,nonMatchingSourceIDs:local.report.nonMatchingSourceIDs,
    status:validation.errors.length||reconciliation.report.unresolved.length?'invalid':validation.review.length?'needs_review':'generated_unverified',...validation,
    assumptions:result.assumptions,externalDependencies:result.externalDependencies,
    reconciliation:reconciliation.report,angularCompilation:separated.report};
  await writeFile(join(output,'response.json'),JSON.stringify(result,null,2));await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  if(validation.errors.length)throw new Error(`Fusion invalide : ${validation.errors.slice(0,10).join(' | ')}`);
  if(reconciliation.report.unresolved.length)throw new Error(`Cascade ou conditions non restaurées : ${reconciliation.report.unresolved.map(item=>item.id).join(', ')}`);
  if(separated.report.unresolved.length)throw new Error(`Règles Angular non déplaçables : ${separated.report.unresolved.map(item=>item.id).join(', ')}`);
  const cssPath=join(output,`${input.component}.css`),globalPath=join(output,`${input.component}.context.css`);
  await writeFile(cssPath,separated.componentCSS);await writeFile(globalPath,separated.globalCSS);
  console.log(`CSS du composant : ${cssPath}\nCSS global contextuel : ${globalPath}\nValidation : ${output}/report.json${validation.review.length?' (points à vérifier)':''}`);
  process.exitCode=validation.review.length?2:0;
}catch(error){console.error(error.message);process.exitCode=1;}
