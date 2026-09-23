import {test} from 'node:test';
import assert from 'node:assert/strict';
import {separateAngularCSS} from '../src/angular-css.js';

test('uses @scope for a pathological host rule and keeps its complete context',async()=>{
 const context='.fhome fho-cover .account-row.wrap > ion-col.account-title + ion-col.account-details > ion-grid > ion-row.row-list:not(ion-row:has(ion-col:nth-child(2))) + ion-row:last-child > ion-col';
 const css=`/* r1 */\n:host-context(.fhome fho-cover) :host .btn { color: red; }\n/* r359 */\n@media all { @media screen and (min-width: 1200px) { :host-context(${context}) :host { margin-left: calc(47.9% + 31px); } } }`;
 const result=await separateAngularCSS(css,'fbr-button',{timeoutMs:1000});
 assert.equal(result.report.componentCompiles,true);
 assert.deepEqual(result.report.scoped.map(item=>item.id),['r359']);
 assert.deepEqual(result.report.moved,[]);
 assert.match(result.componentCSS,/:host-context\(\.fhome fho-cover\) :host \.btn/);
 assert.match(result.componentCSS,/@scope \(\.fhome fho-cover \.account-row\.wrap/);
 assert.match(result.componentCSS,/47\.9%/);
 assert.equal((result.componentCSS.match(/@media/g)||[]).length,1);
 assert.equal(result.globalCSS.trim(),'');
});
