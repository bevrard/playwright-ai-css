import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {encapsulateStyle} from '@angular/compiler';
import {reconcileAIResponses} from '../src/ai/reconcile.js';

test('restores print media and the observed 42px cascade without another AI call',async()=>{
 const print={id:'r0',kind:'CSSStyleRule',selector:'*, ::after, ::before',css:'color: black !important;',role:'required'};
 const global={id:'r1',kind:'CSSStyleRule',selector:'.cfcal .primary-button',css:'height: 150px;',role:'required'};
 const input={definitions:[{id:'g0',kind:'CSSMediaRule',header:'@media print',role:'dependency'},print,global],
  captures:[{rules:[[0,'g0',0,null,0,null],[1,'r0',0,0,0,null],[2,'r1',0,null,1,null]],sheets:[{id:0,media:''}]}]};
 const archive={dictionary:['.cfcal .primary-button','height: 150px;','{"height":"42px"}'],
  captures:[{rules:[{selectorRef:0,cssRef:1,candidates:[{reason:'matches-current-context',nodes:[1]}]}],nodes:[{id:1,computedRef:2}]}]};
 const responses=[{css:':host *, :host ::after, :host ::before {color: black !important;}\n:host-context(.cfcal) :host .primary-button {height: 150px;}'}];
 const result=reconcileAIResponses({input,archive,ambiguous:[print,global],responses});
 assert.deepEqual(result.report.unresolved,[]);
 assert.deepEqual(result.report.restoredConditions.map(item=>item.id),['r0']);
 assert.deepEqual(result.report.priorityAdjusted.map(item=>item.id),['r1']);
 assert.match(result.css,/@media print/);assert.match(result.css,/:where\(\.primary-button\)/);
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const compiled=encapsulateStyle(':host-context(.cfcal) :host .btn {height:42px;color:red;}\n'+result.css,'probe');
  await page.setContent(`<style>${compiled}</style><div class="cfcal"><fbr-button _nghost-probe><button class="btn primary-button" _ngcontent-probe>OK</button></fbr-button></div>`);
  const read=()=>page.locator('button').evaluate(node=>({height:getComputedStyle(node).height,color:getComputedStyle(node).color}));
  assert.deepEqual(await read(),{height:'42px',color:'rgb(255, 0, 0)'});
  await page.emulateMedia({media:'print'});
  assert.deepEqual(await read(),{height:'42px',color:'rgb(0, 0, 0)'});
 }finally{await browser.close();}
});
