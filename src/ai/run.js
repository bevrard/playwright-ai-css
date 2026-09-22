import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildInput} from './input.js';
import {buildCLIRequest,generateCLI} from './cli-provider.js';
import {validateResult} from './validate.js';

export async function locateArchive(input,root='artifacts') {
  if(input){const path=resolve(input);return (await stat(path)).isDirectory()?join(path,'archive.json'):path;}
  const entries=await readdir(resolve(root),{withFileTypes:true}).catch(()=>[]);
  for(const entry of entries.filter(e=>e.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name))){
    const path=resolve(root,entry.name,'archive.json');
    try{await stat(path);return path;}catch{}
  }
  throw new Error('Aucune collecte trouvée. Lancer npm run collect ou fournir --input.');
}
export async function runAI(options={}, {env=process.env,execute,log=console.log}={}) {
  const provider=options.provider;
  if(!['openai','claude','gemini','mistral-vibe'].includes(provider))throw new Error('--provider doit être openai, claude, gemini ou mistral-vibe.');
  const maxInputChars=options.maxInputChars??((provider==='gemini'||provider==='mistral-vibe')?2000000:600000),timeout=options.timeout??1200000;
  for(const value of [maxInputChars,timeout])if(!Number.isSafeInteger(value)||value<1)throw new Error('Les limites doivent être des entiers positifs.');
  const archivePath=await locateArchive(options.input,options.artifactsRoot);
  let collectionReport;
  try{collectionReport=JSON.parse(await readFile(join(dirname(archivePath),'report.json'),'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const archive=JSON.parse(await readFile(archivePath,'utf8'));
  if(collectionReport&&(collectionReport.failures||collectionReport.captured!==collectionReport.planned))throw new Error('Collecte incomplète : consulter report.json, corriger puis relancer collect.');
  if(archive.plannedCases?.length&&archive.captures?.length!==archive.plannedCases.length)throw new Error('Archive incomplète : nombre de captures différent des cas planifiés.');
  const input=buildInput(archive,options.component);
  const promptPath=resolve(options.prompt||fileURLToPath(new URL('../../prompts/regenerate-css.md',import.meta.url)));
  const prompt=await readFile(promptPath,'utf8');
  const model=options.model||(provider==='openai'?(env.CODEX_MODEL||'gpt-5.6-terra'):provider==='claude'?env.CLAUDE_MODEL:provider==='mistral-vibe'?(env.MISTRAL_VIBE_MODEL||env.MISTRAL_MODEL):env.GEMINI_MODEL)||null;
  const reasoningEffort=provider==='openai'?(options.effort||env.CODEX_REASONING_EFFORT||'medium'):null;
  if(reasoningEffort&&!['none','minimal','low','medium','high','xhigh','max'].includes(reasoningEffort))throw new Error('--effort doit être none, minimal, low, medium, high, xhigh ou max.');
  const outputRoot=resolve(options.output||join(dirname(archivePath),'ai'));
  await mkdir(outputRoot,{recursive:true});
  // Exclusive directory creation avoids overwriting an earlier result.
  const output=join(outputRoot,`${provider}-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}`);
  await mkdir(output);
  const request=buildCLIRequest({provider,model,reasoningEffort,prompt,input,output});
  const inputCharacters=JSON.stringify(input).length,requestCharacters=request.stdin.length;
  const plan={transport:'cli',command:request.command,provider,model:model||'CLI default',reasoningEffort:reasoningEffort||null,archivePath,promptPath,component:input.component,captures:input.captures.length,
    definitions:input.definitions.length,occurrences:input.captures.reduce((n,c)=>n+c.rules.length,0),
    requiredDefinitions:input.completeness.requiredDefinitionIDs.length,requiredDeclarations:input.completeness.requiredDeclarationCount,
    inputCharacters,requestCharacters,maxInputChars,timeout,
    withinBudget:requestCharacters<=maxInputChars,coverage:input.coverage,
    legacyCaptures:input.captures.filter(c=>c.analysisVersion==='legacy').length,
    note:'Caractères, pas tokens. Session CLI existante ; limites du compte applicables. Pas de relance par le wrapper ; le CLI gère ses propres échanges et retries. Aucune validation Angular ou visuelle.'};
  const save=(name,data)=>writeFile(join(output,name),typeof data==='string'?data:JSON.stringify(data,null,2));
  await save('request.txt',request.stdin);await save('input.json',JSON.stringify(input));await save('prompt.md',prompt);await save('plan.json',plan);
  log(`${input.component} : ${input.captures.length} captures, ${input.definitions.length} définitions, ${requestCharacters.toLocaleString('fr-FR')} caractères de requête.`);
  if(options.dryRun){await save('report.json',{status:'prepared',...plan});log(`Préparation sans lancement du CLI : ${output}`);return {output,plan,exitCode:0};}
  try{
    if(!plan.withinBudget)throw new Error(`Budget dépassé (${requestCharacters} > ${maxInputChars} caractères). Rien envoyé. Recollecter avec le filtre actuel, réduire la portée ou relever explicitement --max-input-chars après examen de input.json.`);
    const response=await generateCLI(request,{env,timeout,execute});
    await save('response.json',response);
    const validation=validateResult(response.result,input);
    const report={...plan,status:validation.errors.length?'invalid':validation.review.length?'needs_review':'generated_unverified',
      errors:validation.errors,review:validation.review,usage:response.usage,responseId:response.responseId,
      assumptions:response.result.assumptions,externalDependencies:response.result.externalDependencies,
      angularValidation:'not_run',visualValidation:'not_run'};
    await save('report.json',report);
    if(validation.errors.length){log(`Réponse invalide, aucun fichier CSS publié : ${output}/report.json`);return {output,plan,report,exitCode:1};}
    const cssPath=join(output,`${input.component}.css`);
    await save(`${input.component}.css`,response.result.css.trim()+'\n');
    log(`CSS généré : ${cssPath}\nRapport : ${output}/report.json${validation.review.length?' (points à vérifier)':''}`);
    return {output,cssPath,plan,report,exitCode:validation.review.length?2:0};
  }catch(e){await save('report.json',{...plan,status:'failed',error:e.message});throw new Error(`${e.message}\nDossier : ${output}`,{cause:e});}
}
