import {test} from 'node:test';
import assert from 'node:assert/strict';
import {convertSelector,prepareLocalCSS} from '../src/local-css.js';

test('deterministic selector conversion handles explicit hosts and Angular scope, rejects unproven ancestors',()=>{
 const evidence={hostAttributes:new Set(['_nghost-a']),contentAttributes:new Set(['_ngcontent-a'])};
 assert.deepEqual(convertSelector('.theme fbr-button.primary > button[_ngcontent-a]:hover','fbr-button',evidence),
  {safe:true,selector:':host-context(.theme) :host(.primary)> button:hover'});
 assert.deepEqual(convertSelector('[_nghost-a].wide .btn[_ngcontent-a]','fbr-button',evidence),
  {safe:true,selector:':host(.wide) .btn'});
 assert.deepEqual(convertSelector('.btn[_ngcontent-a]','fbr-button',evidence),{safe:true,selector:':host .btn'});
 assert.equal(convertSelector('.row:has(fbr-button)','fbr-button',evidence).safe,false);
 assert.equal(convertSelector('.external .btn','fbr-button',evidence).safe,false);
});

test('preserves the complete ancestor path in deterministic conversion',()=>{
 const result=convertSelector('.fhome fho-cover .account-title fbr-button','fbr-button');
 assert.deepEqual(result,{safe:true,selector:':host-context(.fhome fho-cover .account-title) :host'});
});

test('preserves a source :is() with no matches as an explicit inactive rule',()=>{
 assert.deepEqual(convertSelector(':is() fbr-button[_ngcontent-a]','fbr-button'),
  {safe:true,selector:':host:not(*)',nonMatching:true});
});

test('local preparation separates safe and ambiguous required rules and preserves media headers',()=>{
 const input={component:'fbr-button',attributes:[{'_nghost-a':''},{'_ngcontent-a':''}],
  completeness:{requiredDefinitionIDs:['r0','r1']},
  definitions:[
   {id:'g0',kind:'CSSMediaRule',header:'@media (max-width: 600px)',role:'dependency'},
   {id:'r0',kind:'CSSStyleRule',selector:'fbr-button > button[_ngcontent-a]',css:'color: red;',role:'required'},
   {id:'r1',kind:'CSSStyleRule',selector:'.outside .btn',css:'color: blue;',role:'required'}],
  captures:[{targets:[{node:0}],nodes:[[0,'fbr-button',0,null,[1]],[1,'button',1,0,[]]],sheets:[{id:0,media:''}],
   rules:[[10,'g0',0,null,0,null],[11,'r0',0,10,0,null],[12,'r1',0,null,1,null]]}]};
 const prepared=prepareLocalCSS(input);
 assert.deepEqual(prepared.report,{required:2,safe:1,ambiguous:1,safeIDs:['r0'],ambiguousIDs:['r1'],nonMatchingSourceIDs:[]});
 assert.match(prepared.css,/@media \(max-width: 600px\)/);assert.match(prepared.css,/:host> button/);
});
