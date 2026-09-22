import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectInBrowser } from '../src/collector.js';
import { append, compact } from '../src/exporter.js';
import { startDemoServer } from '../src/demo-server.js';
let service,browser;
before(async()=>{service=await startDemoServer();browser=await chromium.launch();});
after(async()=>{await browser?.close();await service?.stop();});
test('real Chromium: DOM boundaries, computed styles, inactive media and compact references',async()=>{
 const page=await browser.newPage({viewport:{width:1024,height:800}});
 try {
  await page.goto(service.baseURL);
  const snapshot=await page.evaluate(collectInBrowser,{options:{selectors:['fbr-button']},label:'fixture'});
  assert.equal(snapshot.targets.length,1);
  assert(!snapshot.nodes.some(n=>n.attrs.class==='private-child'));
  assert(snapshot.nodes.some(n=>n.tag==='fmo-child'&&n.boundary));
  assert(snapshot.rules.some(r=>r.header?.includes('4000px')&&r.matchesNow===false));
  assert(snapshot.nodes.some(n=>n.computed?.height==='42px'));
  const archive={dictionary:[],captures:[]};append(archive,snapshot);
  const dictionarySize=archive.dictionary.length;
  append(archive,await page.evaluate(collectInBrowser,{options:{selectors:['fbr-button']},label:'again'}));
  assert.equal(archive.dictionary.length,dictionarySize);
  const ai=compact(archive);
  assert.equal(ai.captures.length,2);
  const omitted=ai.captures[0].omittedRuleIDs;
  assert(omitted.length>0);
  for(const capture of ai.captures)for(const r of capture.rules)for(const key of ['cssRef','headerRef','selectorRef']) {
   if(r[key]!==undefined)assert.equal(typeof ai.dictionary[r[key]],'string');
  }
 } finally {await page.close();}
});
test('real Chromium: dynamic modal, hover state and explicit zero matches',async()=>{
 const page=await browser.newPage();
 try {
  await page.goto(service.baseURL+'/detail');await page.locator('#open').click();
  await page.locator('fbr-button').first().hover();
  const s=await page.evaluate(collectInBrowser,{options:{selectors:['fbr-button','.missing']}});
  assert.equal(s.selection[0].count,2);assert.equal(s.selection[1].count,0);
  assert(s.nodes.some(n=>n.tag==='fbr-button'&&n.states.hover));
  assert(s.nodes.some(n=>n.computed?.height==='55px'));
 } finally {await page.close();}
});
