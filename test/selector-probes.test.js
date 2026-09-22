import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {selectorProbes,collectPage} from '../src/selector-probes.js';
import {append,compact} from '../src/exporter.js';

test('AST probes broaden functional/escaped states and preserve unknown syntax',()=>{
 assert.equal(selectorProbes('fbr-button .btn:not(:disabled)')['fbr-button .btn:not(:disabled)'],'fbr-button .btn');
 assert.equal(selectorProbes(':is(.a, .b) > :hover')[':is(.a, .b) > :hover'],'* > *');
 assert.equal(selectorProbes('button[disabled]')['button[disabled]'],'button');
 assert.equal(selectorProbes('svg|a')['svg|a'],null);
 assert.equal(selectorProbes('x-thing::part(icon)')['x-thing::part(icon)'],null);
 assert.equal(selectorProbes('& .btn')['& .btn'],null);
});
test('Chromium retains inactive state/media rules but filters unrelated complex selectors, with originals archived',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent(`<style>
   fbr-button .btn:not(:disabled){color:red}
   fbr-button:is(.special,.another) > button:disabled{color:blue}
   .unrelated:not(.x) .absent{color:pink}
   .future-context fbr-button .optional-leaf{border:3px solid orange}
   .escaped\\:name:not(.x){color:purple}
   @media(min-width:4000px){fbr-button .btn:focus-visible{color:green}}
   fbr-button .btn::before{content:'x'}
  </style><fbr-button><button class="btn escaped:name">Test</button></fbr-button>`);
  const snapshot=await collectPage(page,{options:{selectors:['fbr-button']},label:'test'});
  const archive={dictionary:[],captures:[]};append(archive,snapshot);const ai=compact(archive);
  const kept=ai.captures[0].rules.map(r=>archive.dictionary[r.selectorRef]).filter(Boolean);
  assert(kept.some(s=>s.includes(':disabled')));assert(kept.some(s=>s.includes(':focus-visible')));assert(kept.some(s=>s.includes('escaped')));assert(kept.some(s=>s.includes('::before')));
  assert(!kept.some(s=>s.includes('.unrelated')));
  assert(kept.some(s=>s.includes('.optional-leaf')));
  assert(archive.dictionary.some(s=>s.includes('.unrelated')));assert.equal(snapshot.analysisVersion,'ast-superset-v1');
 }finally{await browser.close();}
});
