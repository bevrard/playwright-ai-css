import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import demo from '../scenarios.demo.mjs';
test('runner exports successful and missing-selector cases, with screenshots and archive',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'css-context-test-'));
 try {
  const modal={...demo.scenarios[1],
    prepare:async page=>{
      await demo.scenarios[1].prepare(page);
      await page.addStyleTag({content:'.modal fbr-button { display: contents; }'});
    },
    targets:[{name:'confirm',selector:'.modal fbr-button',screenshotSelector:'.modal fbr-button > button'}]};
  const ambiguous={...demo.scenarios[1],name:'ambiguous',targets:[{name:'not-unique',selector:'fbr-button'}]};
  const config={...demo,widths:[375],scenarios:[modal,{name:'missing',path:'/',collector:{selectors:['.absent']}},ambiguous]};
  const result=await run(config,{outputRoot:dir,log:()=>{}});
  assert.equal(result.failed,true);assert.equal(result.results[0].status,'captured');assert.equal(result.results[1].status,'failed');
  const report=JSON.parse(await readFile(join(result.output,'report.json'),'utf8'));
  assert.equal(report.planned,3);assert.equal(report.failures,2);
  assert.match(result.results[2].error,/2 éléments/);
  const archive=JSON.parse(await readFile(join(result.output,'archive.json'),'utf8'));
  assert.equal(archive.captures.length,2);
  const png=await readFile(join(result.output,result.results[0].screenshot));assert.equal(png[0],137);
  const target=result.results[0].targets[0];assert.equal(target.name,'confirm');
  assert.equal((await readFile(join(result.output,target.screenshot)))[0],137);
  assert.equal(archive.captures[0].targetDefinitions[0].selector,'.modal fbr-button');
  const host=archive.captures[0].nodes[archive.captures[0].targets[0].node];
  assert.equal(host.tag,'fbr-button');assert.equal(host.rect.width,0);
  assert.equal(target.screenshotSelector,'.modal fbr-button > button');
  const ai=JSON.parse(await readFile(join(result.output,'ai-context.json'),'utf8'));
  assert.equal(ai.captures[0].screenshots.targets[0].name,'confirm');
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('bounded retry recovers a temporary HTTP 401 and records both attempts',async()=>{
 const {createServer}=await import('node:http');
 let requests=0;
 const server=createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  requests++;
  if(requests===1){res.writeHead(401);res.end('temporary access state');return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<fbr-button style="display:block"><button>Ready</button></fbr-button>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const dir=await mkdtemp(join(tmpdir(),'css-context-retry-'));
 try{
  const result=await run({baseURL:`http://127.0.0.1:${server.address().port}`,widths:[375],navigationAttempts:2,
   scenarios:[{name:'retry',path:'/'}]}, {outputRoot:dir,log:()=>{}});
  assert.equal(result.failed,false);
  assert.deepEqual(result.results[0].navigations.map(n=>n.status),[401,200]);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
