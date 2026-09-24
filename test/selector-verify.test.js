import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyAndRebaseSelectors} from '../src/ai/selector-verify.js';

function fixture(component,source,generated,tree){
 const dictionary=[],intern=value=>{dictionary.push(typeof value==='string'?value:JSON.stringify(value));return dictionary.length-1;};
 const nodes=tree.map(([tag,attrs,parent],id)=>({id,tag,attrsRef:intern(attrs),parent,children:[]}));
 for(const node of nodes)if(node.parent!=null)nodes[node.parent].children.push(node.id);
 return {archive:{dictionary,captures:[{label:'fixture',nodes,targets:[{node:tree.findIndex(row=>row[0]===component)}]}]},
  definitions:[{id:'r1',selector:source,css:'display: none;'}],css:`${generated} {display: none;}`};
}

test('rebases an ancestor and sibling rule at the toolbar host',async()=>{
 const input=fixture('fbr-header-toolbar-menu-item',
  '.fhome fho-header .toolbar-menu-item-icon + .toolbar-menu-item-text',
  ':host-context(.fhome) :host fho-header .toolbar-menu-item-icon + .toolbar-menu-item-text',[
   ['html',{},null],['body',{class:'fhome'},0],['fho-header',{},1],
   ['fbr-header-toolbar-menu-item',{'_nghost-ng-c1':''},2],
   ['div',{'_ngcontent-ng-c1':'',class:'toolbar-menu-item-icon'},3],
   ['span',{'_ngcontent-ng-c1':'',class:'toolbar-menu-item-text'},3]
  ]);
 const result=await verifyAndRebaseSelectors({...input,component:'fbr-header-toolbar-menu-item'});
 assert.deepEqual(result.report.unresolved,[]);
 assert.deepEqual(result.report.corrected.map(item=>item.id),['r1']);
 assert.match(result.css,/:host-context\(\.fhome fho-header\) :host \.toolbar-menu-item-icon \+ \.toolbar-menu-item-text/);
});

test('rebases a wrapper inside the nested notification host',async()=>{
 const input=fixture('fbr-header-notifications',
  '.cfcal fbr-header-toolbar-menu-item .toolbar-menu-item .counter-wrapper',
  ':host-context(.cfcal) :host fbr-header-toolbar-menu-item .toolbar-menu-item .counter-wrapper',[
   ['html',{},null],['body',{class:'cfcal'},0],['fbr-header-toolbar-menu-item',{},1],
   ['div',{class:'toolbar-menu-item'},2],['fbr-header-notifications',{'_nghost-ng-c2':''},3],
   ['div',{'_ngcontent-ng-c2':'',class:'counter-wrapper'},4]
  ]);
 const result=await verifyAndRebaseSelectors({...input,component:'fbr-header-notifications'});
 assert.deepEqual(result.report.unresolved,[]);
 assert.deepEqual(result.report.corrected.map(item=>item.id),['r1']);
 assert.match(result.css,/:host-context\(\.cfcal fbr-header-toolbar-menu-item \.toolbar-menu-item\) :host \.counter-wrapper/);
});

test('blocks publication when an observed source rule cannot be linked to its generated rule',async()=>{
 const input=fixture('fbr-header-notifications','.cfcal .counter-wrapper',':host .different .counter-wrapper',[
  ['html',{},null],['body',{class:'cfcal'},0],['fbr-header-notifications',{'_nghost-ng-c2':''},1],
  ['div',{'_ngcontent-ng-c2':'',class:'counter-wrapper'},2]
 ]);
 const result=await verifyAndRebaseSelectors({...input,component:'fbr-header-notifications'});
 assert.deepEqual(result.report.corrected,[]);
 assert.deepEqual(result.report.unresolved.map(item=>item.id),['r1']);
});
