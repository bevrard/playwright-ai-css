import postcss from 'postcss';
import parser from 'postcss-selector-parser';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const worker=fileURLToPath(new URL('./angular-compile-worker.js',import.meta.url));

export function compilesInAngular(css,{timeoutMs=3000}={}){
 return new Promise(resolve=>{
  const child=spawn(process.execPath,[worker],{stdio:['pipe','pipe','pipe']});
  let stderr='',settled=false;
  const done=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');done({ok:false,reason:'timeout'});},timeoutMs);
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',error=>done({ok:false,reason:String(error)}));
  child.on('close',code=>done({ok:code===0,reason:code===0?'':stderr||`exit ${code}`}));
  child.stdin.on('error',()=>{});child.stdin.end(css);
 });
}

function unitsFromCSS(css){
 const root=postcss.parse(css),units=[];
 function visit(container,wrappers=[],label=''){
  let currentLabel=label;
  for(const node of container.nodes||[]){
   if(node.type==='comment'){currentLabel=node.text.trim();continue;}
   if(node.type==='atrule'&&node.nodes&&node.name!=='keyframes'&&node.name!=='-webkit-keyframes'){
    visit(node,[...wrappers,{name:node.name,params:node.params}],currentLabel);currentLabel='';continue;
   }
   units.push({node:node.clone(),wrappers,id:currentLabel,source:node.toString()});
   currentLabel='';
  }
 }
 visit(root);return units;
}

function wrapCSS(node,wrappers){
 for(const wrapper of [...wrappers].reverse()){
  if(wrapper.name==='media'&&wrapper.params.trim().toLowerCase()==='all')continue;
  const parent=postcss.atRule(wrapper);parent.append(node);node=parent;
 }
 return node.toString();
}

function unitCSS(unit,selector=unit.node.selector){
 let node=unit.node.clone();if(selector!==undefined)node.selector=selector;
 return wrapCSS(node,unit.wrappers);
}

function hostContexts(selector){
 const root=parser().astSync(selector),branches=[];
 for(const branch of root.nodes){
  const nodes=[...branch.nodes];
  const context=nodes[0];
  if(context?.type!=='pseudo'||context.value!==':host-context'||context.nodes?.length!==1)return null;
  const host=nodes.find((node,index)=>index>0&&node.type==='pseudo'&&node.value===':host');
  if(!host||host.nodes?.length||nodes.at(-1)!==host)return null;
  if(nodes.slice(1,-1).some(node=>node.type!=='combinator'||node.value.trim()))return null;
  branches.push(context.nodes[0].toString());
 }
 return branches;
}

function scopedHostCSS(unit,contexts){
 return contexts.map(context=>{
  const rule=unit.node.clone();rule.selector=':host';
  const scope=postcss.atRule({name:'scope',params:`(${context})`});scope.append(rule);
  return wrapCSS(scope,unit.wrappers);
 });
}

async function findFailures(units,timeoutMs){
 const css=units.map(unit=>unitCSS(unit)).join('\n');
 const check=await compilesInAngular(css,{timeoutMs});
 if(check.ok)return [];
 if(units.length===1)return [{unit:units[0],reason:check.reason}];
 const middle=Math.floor(units.length/2);
 return [...await findFailures(units.slice(0,middle),timeoutMs),...await findFailures(units.slice(middle),timeoutMs)];
}

export async function separateAngularCSS(css,component,{timeoutMs=3000}={}){
 const units=unitsFromCSS(css),failed=await findFailures(units,timeoutMs),failureMap=new Map(failed.map(item=>[item.unit,item.reason]));
 const componentParts=[],globalUnits=[],moved=[],scoped=[],unresolved=[];
 for(const unit of units){
  const reason=failureMap.get(unit);
  if(!reason){componentParts.push(unitCSS(unit));continue;}
  const contexts=unit.node.type==='rule'?hostContexts(unit.node.selector):null;
  if(!contexts){unresolved.push({id:unit.id,selector:unit.node.selector||'',reason});continue;}
  const scopedParts=scopedHostCSS(unit,contexts);
  if((await compilesInAngular(scopedParts.join('\n'),{timeoutMs})).ok){
   componentParts.push(...scopedParts);scoped.push({id:unit.id,selector:unit.node.selector,scopeRoots:contexts,reason});continue;
  }
  const selector=contexts.map(context=>`${context} ${component}`).join(', ');
  globalUnits.push({unit,selector});moved.push({id:unit.id,selector:unit.node.selector,globalSelector:selector,reason});
 }
 const componentCSS=[...new Set(componentParts)].join('\n\n')+'\n';
 const globalCSS=[...new Set(globalUnits.map(({unit,selector})=>`${unit.id?`/* ${unit.id} */\n`:''}${unitCSS(unit,selector)}`))].join('\n\n')+'\n';
 const finalCheck=await compilesInAngular(componentCSS,{timeoutMs});
 if(!finalCheck.ok)unresolved.push({id:'combined',selector:'',reason:finalCheck.reason});
 return {componentCSS,globalCSS,report:{checked:units.length,scoped,moved,unresolved,componentCompiles:finalCheck.ok}};
}
