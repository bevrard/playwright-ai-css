import postcss from 'postcss';
import parser from 'postcss-selector-parser';
import {encapsulateStyle} from '@angular/compiler';
import {chromium} from 'playwright';

const signature=css=>JSON.stringify(postcss.parse(`x{${css}}`).first.nodes.filter(n=>n.type==='decl').map(n=>[n.prop.toLowerCase(),n.value.trim(),!!n.important]));
const ruleSignature=rule=>JSON.stringify(rule.nodes.filter(n=>n.type==='decl').map(n=>[n.prop.toLowerCase(),n.value.trim(),!!n.important]));

function flatten(selector){
 try{
  const branch=parser().astSync(selector).nodes[0],parts=[];
  for(const node of branch.nodes){
   if(node.type==='pseudo'&&node.value===':host-context'){parts.push(node.nodes?.[0]?.toString()||'');continue;}
   if(node.type==='pseudo'&&node.value===':host')continue;
   if(node.type==='pseudo'&&node.value===':where'&&node.nodes?.length===1){parts.push(node.nodes[0].toString());continue;}
   parts.push(node.toString());
  }
  return parts.join('').replace(/\s+/g,' ').trim();
 }catch{return '';}
}

function splitCandidates(source,{preserveWhere=false}={}){
 try{
  const branches=parser().astSync(source).nodes;
  if(branches.length!==1)return [];
  const nodes=[...branches[0].nodes],result=[];
  for(let i=1;i<nodes.length-1;i++){
   if(nodes[i].type!=='combinator'||nodes[i].value.trim())continue;
   const prefix=nodes.slice(0,i).map(n=>n.toString()).join('').trim();
   let suffix=nodes.slice(i+1).map(n=>n.toString()).join('').trim();
   if(!prefix||!suffix)continue;
   if(preserveWhere&&/^\.[\w-]+$/.test(suffix))suffix=`:where(${suffix})`;
   result.push(`:host-context(${prefix}) :host ${suffix}`);
  }
  return [...new Set(result)];
 }catch{return [];}
}

function eligible(source){
 try{
  if(/_ng(?:host|content)-/.test(source))return false;
  const branches=parser().astSync(source).nodes;
  return branches.length===1&&branches[0].nodes.some(node=>node.type==='combinator'&&!node.value.trim())&&
   !branches[0].nodes.some(node=>node.type==='universal'||node.type==='pseudo'&&node.value.startsWith('::'));
 }catch{return false;}
}

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function captureHTML(capture,dictionary){
 const nodes=new Map(capture.nodes.map(node=>[node.id,node]));
 const render=id=>{
  const node=nodes.get(id);if(!node||!node.tag||node.tag.startsWith('#'))return '';
  const attrs=JSON.parse(dictionary[node.attrsRef]||'{}');
  const attributes=Object.entries(attrs).filter(([name])=>!name.startsWith('data-codex-')).map(([name,value])=>` ${name}="${escape(value)}"`).join('');
  return `<${node.tag}${attributes} data-codex-node="${id}">${(node.children||[]).map(render).join('')}</${node.tag}>`;
 };
 return capture.nodes.filter(node=>node.parent==null).map(node=>render(node.id)).join('');
}

function scopedSelector(selector,scope){
 try{
  const css=encapsulateStyle(`${selector}{outline:0}`,scope);
  return postcss.parse(css).first.selector;
 }catch{return null;}
}

async function selectedIds(page,selector,hostIds){
 if(!selector)return null;
 return page.evaluate(({selector,hostIds})=>{
  try{
   const hosts=hostIds.map(id=>document.querySelector(`[data-codex-node="${id}"]`)).filter(Boolean);
   return [...document.querySelectorAll(selector)].filter(node=>hosts.some(host=>host.contains(node))).map(node=>Number(node.getAttribute('data-codex-node'))).filter(Number.isFinite).sort((a,b)=>a-b);
  }catch{return null;}
 },{selector,hostIds});
}

// Verify observed selector targets after Angular encapsulation. Only an
// equivalent, uniquely determined boundary split may replace the AI selector.
export async function verifyAndRebaseSelectors({css,archive,component,definitions}){
 const root=postcss.parse(css),report={corrected:[],unresolved:[],unobserved:[],unchecked:[]};
 const rules=[];root.walkRules(rule=>{if(!['keyframes','-webkit-keyframes'].includes(rule.parent?.name))rules.push(rule);});
 const browser=await chromium.launch({headless:true});
 try{
  const captures=[];
  for(const capture of archive.captures){
   const hostIds=capture.targets.filter(target=>capture.nodes.find(node=>node.id===target.node)?.tag===component).map(target=>target.node);
   if(!hostIds.length)continue;
   const host=capture.nodes.find(node=>node.id===hostIds[0]);
   const attrs=JSON.parse(archive.dictionary[host.attrsRef]||'{}');
   const scope=Object.keys(attrs).find(name=>name.startsWith('_nghost-'))?.slice('_nghost-'.length);
   if(!scope)continue;
   const page=await browser.newPage();await page.setContent(captureHTML(capture,archive.dictionary));
   captures.push({page,scope,hostIds,label:capture.label});
  }
  for(const definition of definitions){
   if(!eligible(definition.selector)){report.unchecked.push(definition.id);continue;}
   const observations=[];
   for(const capture of captures){
    const source=await selectedIds(capture.page,definition.selector,capture.hostIds);
    if(source?.length)observations.push({...capture,source});
   }
   if(!observations.length){report.unobserved.push(definition.id);continue;}
   const matches=rules.filter(rule=>ruleSignature(rule)===signature(definition.css)&&flatten(rule.selector)===definition.selector.replace(/\s+/g,' ').trim());
   if(matches.length!==1){report.unresolved.push({id:definition.id,reason:`Règle générée non identifiable (${matches.length})`});continue;}
   const rule=matches[0];
   const equivalent=async selector=>{
    for(const capture of observations){
     const actual=await selectedIds(capture.page,scopedSelector(selector,capture.scope),capture.hostIds);
     if(JSON.stringify(actual)!==JSON.stringify(capture.source))return false;
    }
    return true;
   };
   if(await equivalent(rule.selector))continue;
   const candidates=[];
   for(const selector of splitCandidates(definition.selector,{preserveWhere:rule.selector.includes(':where(')}))if(await equivalent(selector))candidates.push(selector);
   if(candidates.length===1){rule.selector=candidates[0];report.corrected.push({id:definition.id,source:definition.selector,selector:rule.selector,captures:observations.map(c=>c.label)});}
   else report.unresolved.push({id:definition.id,source:definition.selector,generated:rule.selector,reason:`Frontière non déterminée (${candidates.length} conversion(s) équivalente(s))`});
  }
  for(const capture of captures)await capture.page.close();
 }finally{await browser.close();}
 return {css:root.toString(),report};
}
