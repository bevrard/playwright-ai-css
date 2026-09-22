import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import config from '../scenarios.chromatic.mjs';
test('Chromatic configuration: three stories, eight native CSS selectors, 1280x720',async()=>{
 assert.deepEqual(config.widths,[1280]);assert.equal(config.height,720);
 assert.deepEqual(config.scenarios.map(s=>s.targets.length),[5,2,1]);
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  for(const scenario of config.scenarios){
   const url=new URL(scenario.path,config.baseURL);
   assert.equal(url.pathname,'/iframe.html');assert.equal(url.searchParams.get('globals'),'viewport:w1280h720');assert.equal(url.searchParams.get('viewMode'),'story');
   for(const target of scenario.targets){
    assert(!target.selector.includes('\\'));
    assert(await page.evaluate(selector=>CSS.supports(`selector(${selector})`),target.selector));
   }
  }
 }finally{await browser.close();}
});
test('Chromatic redirects to login fail with actionable instructions',async()=>{
 const page={url:()=> 'https://www.chromatic.com/signin'};
 await assert.rejects(config.scenarios[0].prepare(page),/chromatic:login/);
});
