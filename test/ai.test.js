import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildInput} from '../src/ai/input.js';
import {buildCLIRequest,executeCLI,sessionEnvironment} from '../src/ai/cli-provider.js';
import {validateResult} from '../src/ai/validate.js';
import {runAI} from '../src/ai/run.js';

function archive(){
 const capture={id:0,url:'https://example.test',label:'normal',viewport:{width:1280,height:720},nodes:[{id:0,tag:'fbr-button',attrsRef:0,computedRef:3,children:[],parent:null,states:{hover:false},childrenComplete:true}],targets:[{node:0}],angularHosts:[],sheets:[],warnings:[],rules:[{id:0,type:1,kind:'CSSStyleRule',sheet:0,parent:null,position:0,selectorRef:1,cssRef:2,candidates:[{reason:'matches-current-context',nodes:[0]}]}]};
 return {dictionary:['{}','fbr-button .btn','color: red;',JSON.stringify({'--used':'red','--unused':'blue',display:'block',height:'42px'})],captures:[capture,{...structuredClone(capture),id:1}]};
}
const result=()=>({css:':host .btn {color:red}',coverage:[{sourceIds:['r0'],disposition:'converted',reason:'Style du composant.'}],unresolved:[],assumptions:[],externalDependencies:[]});
test('input shares definitions but preserves source occurrences and omits redundant evidence',()=>{
 const input=buildInput(archive());assert.equal(input.definitions.length,1);assert.equal(input.captures.length,2);
 assert.equal(input.format,'css-regeneration-input-v2');assert.equal(input.definitions[0].role,'required');assert(!('declarations' in input.definitions[0]));
 assert.deepEqual(input.captures[0].rules,[[0,'r0',0,null,0,null]]);assert.equal(input.captures[1].rules.length,1);
 assert.equal(input.attributes.length,1);assert.deepEqual(input.variableSets,[{}]);assert(input.captures.every(c=>c.measurements[0].variableSet===0));assert(!JSON.stringify(input).includes('"candidates":'));
 const variableArchive=archive();variableArchive.dictionary[2]='color: var(--used);';
 const variableInput=buildInput(variableArchive);assert.deepEqual(variableInput.variableSets,[{'--used':'red'}]);assert(!JSON.stringify(variableInput).includes('--unused'));
 assert.throws(()=>buildInput(archive(),'other-button'),/Choisir/);
});
test('input keeps parent predicates and unrelated custom elements out of the required contract',()=>{
 const value=archive(),capture=value.captures[0];
 const add=(selector,reason)=>{
  const selectorRef=value.dictionary.push(selector)-1,cssRef=value.dictionary.push('margin: 1px;')-1;
  capture.rules.push({id:capture.rules.length,type:1,kind:'CSSStyleRule',sheet:0,parent:null,position:capture.rules.length,selectorRef,cssRef,candidates:[{reason}]});
 };
 add('.page:has(fbr-button + fbr-button)','mentions-target-component');
 add('.page:has(fbr-button) > other-widget nav','mentions-target-component');
 add('.theme fho-header ion-img::part(image)','uncertain-selector');
 add('.theme fbr-button .btn','mentions-target-component');
 add('::-webkit-scrollbar-thumb','uncertain-selector');
 value.captures=[capture];
 const input=buildInput(value),bySelector=selector=>input.definitions.find(d=>d.selector===selector);
 assert.equal(bySelector('.page:has(fbr-button + fbr-button)').role,'context');
 assert.equal(bySelector('.page:has(fbr-button) > other-widget nav').role,'context');
 assert.equal(bySelector('.theme fho-header ion-img::part(image)').role,'context');
 assert.equal(bySelector('.theme fbr-button .btn').role,'required');
 assert.equal(bySelector('::-webkit-scrollbar-thumb').role,'required');
});
test('CLI commands use stdin, a schema and optional model; strip inherited API keys',()=>{
 for(const provider of ['openai','claude','gemini','mistral-vibe']){
  const request=buildCLIRequest({provider,model:'chosen',reasoningEffort:provider==='openai'?'medium':null,prompt:'$(never execute)',input:{value:'data'},output:'/tmp/path with spaces'});
  assert(request.stdin.includes('$(never execute)'));
  if(provider==='mistral-vibe'){ assert(request.args.includes('-p')); assert(request.args.includes('--output')); assert(request.args.includes('json')); }
  else { assert(!request.args.includes(request.stdin)); }
  assert(request.args.includes('chosen') || provider!=='mistral-vibe' || request.args.includes('chosen'));
  assert.equal(request.command,provider==='openai'?'codex':provider==='claude'?'claude':provider==='gemini'?'agy':'vibe');
  if(provider==='openai')assert(request.args.includes('model_reasoning_effort="medium"'));
 }
 const env=sessionEnvironment({HOME:'/home/user',CODEX_HOME:'/config',PATH:'/bin',OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret',ANTHROPIC_API_KEY:'secret',GEMINI_API_KEY:'secret',MISTRAL_API_KEY:'secret'});
 assert.deepEqual(env,{HOME:'/home/user',CODEX_HOME:'/config',PATH:'/bin'});
});
test('CSS validation catches unscoped, generated attributes, nested, empty and unaccounted sources',()=>{
 const input=buildInput(archive());assert.deepEqual(validateResult(result(),input).errors,[]);
 for(const css of ['fbr-button .btn {color:red}',':host .btn[_ngcontent-ab] {color:red}',':host {& .btn {color:red}}',':host { @media (min-width:10px) {:host .btn {color:red}}}','/* empty */','color:red;',':host .btn {color:'])assert(validateResult({...result(),css},input).errors.length,css);
 assert(validateResult({...result(),coverage:[]},input).errors.length);
 assert(validateResult({...result(),coverage:[...result().coverage,...result().coverage]},input).errors.length);
 assert(validateResult({...result(),coverage:{}},input).errors.length);
 assert(validateResult({...result(),coverage:[null]},input).errors.length);
 assert(validateResult({...result(),css:':host .btn {background:blue}'},input).errors.some(e=>e.includes('Déclaration obligatoire absente')));
 assert(validateResult({...result(),coverage:[{...result().coverage[0],disposition:'dependency'}]},input).errors.some(e=>e.includes('Règle obligatoire non convertie')));
 assert(validateResult({...result(),coverage:[{...result().coverage[0],disposition:'unresolved'}],unresolved:['conversion partielle']},input).errors.some(e=>e.includes('incomplet')));
 assert.deepEqual(validateResult({...result(),css:'@media (min-width:4000px){:host(:hover) .btn{color:red}} @keyframes fade{from{opacity:0}to{opacity:1}}'},input).errors,[]);
});
test('all CLIs: dry-run, successful CSS, invalid CSS, size limit and incomplete runs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'css-ai-test-'));
 try{
  await writeFile(join(dir,'archive.json'),JSON.stringify(archive()));
  let calls=0;
  const mock=(provider,value=result(),complete=true)=>async request=>{
   calls++;
   if(provider==='claude')return {code:0,stderr:'',stdout:JSON.stringify({subtype:complete?'success':'error_max_turns',is_error:!complete,structured_output:value,usage:{output_tokens:20}})};
   if(provider==='gemini'||provider==='mistral-vibe')return {code:0,stderr:'',stdout:JSON.stringify({is_error:!complete,structured_output:complete?value:null,stats:{output_tokens:20}})};
   await writeFile(request.resultPath,JSON.stringify(value));
   return {code:0,stderr:'',stdout:JSON.stringify({type:complete?'turn.completed':'turn.failed',usage:{output_tokens:20}})+'\n'};
  };
  for(const provider of ['openai','claude','gemini','mistral-vibe']){
   const options={provider,input:dir};
   const deps={env:{},execute:mock(provider),log:()=>{}};
   const before=calls;
   const prepared=await runAI({...options,dryRun:true},deps);assert.equal(calls,before);assert(!prepared.cssPath);
   if(provider==='openai'){assert.equal(prepared.plan.model,'gpt-5.6-terra');assert.equal(prepared.plan.reasoningEffort,'medium');}
   const generated=await runAI(options,deps);assert.equal(calls,before+1);assert.equal(await readFile(generated.cssPath,'utf8'),result().css+'\n');assert.equal(generated.exitCode,2);
   await assert.rejects(()=>runAI({...options,maxInputChars:1},deps),/Budget dépassé/);assert.equal(calls,before+1);
   const invalid=await runAI(options,{...deps,execute:mock(provider,{...result(),css:'button{color:red}'})});
   assert.equal(invalid.exitCode,1);assert(!(await readdir(invalid.output)).some(f=>f.endsWith('.css')));
   await assert.rejects(()=>runAI(options,{...deps,execute:mock(provider,result(),false)}),/incompl[eè]t/);
   await assert.rejects(()=>runAI(options,{...deps,execute:async()=>({code:1,stdout:'',stderr:'not logged in'})}),/a échoué/);
  }
  await writeFile(join(dir,'report.json'),JSON.stringify({planned:2,captured:1,failures:1}));
  await assert.rejects(()=>runAI({provider:'openai',input:dir,dryRun:true}),/Collecte incomplète/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real subprocess transport: large stdin, literal shell syntax, no API keys, exit failure and timeout',async()=>{
 const text='é$(touch NEVER)'.repeat(30000);
 const request={command:process.execPath,args:['-e',`let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({input,key:process.env.ANTHROPIC_API_KEY||null})))`],cwd:tmpdir(),stdin:text};
 const response=await executeCLI(request,{env:{PATH:process.env.PATH,ANTHROPIC_API_KEY:'secret'}});
 assert.equal(response.code,0);assert.deepEqual(JSON.parse(response.stdout),{input:text,key:null});
 const failed=await executeCLI({...request,args:['-e','process.exit(7)']});assert.equal(failed.code,7);
 const timed=await executeCLI({...request,args:['-e','setInterval(()=>{},1000)'],stdin:''},{timeout:50});assert.match(timed.error,/Délai/);
 await assert.rejects(()=>executeCLI({...request,command:'/nonexistent/cli'}),/introuvable/);
});
