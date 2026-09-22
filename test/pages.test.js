import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pagesToConfig} from '../src/pages.js';

const page={url:'https://example.test/a?x=1',selectors:['fbr-button']};
test('minimal page list and options preserve URLs, origins and selectors',()=>{
 const config=pagesToConfig([page,{...page,url:'https://other.test/b',viewport:{width:375,height:800}}]);
 assert.equal(config.screenshots,false);assert.equal(config.scenarios.length,2);
 assert.equal(config.scenarios[0].path,page.url);assert.equal(config.scenarios[1].path,'https://other.test/b');
 assert.deepEqual(config.scenarios[1].widths,[375]);
 const options=pagesToConfig({pages:[page],storageState:'session.json',viewport:{width:1280,height:720}},{directory:'/tmp/config'});
 assert.equal(options.context.storageState,'/tmp/config/session.json');
});
test('invalid or misspelled manifests fail before launching a browser',()=>{
 for(const value of [[],{pages:[{...page,selectors:[]}]},{pages:[{...page,url:'file:///tmp/page.html'}]},
  {pages:[{...page,url:'https://user:secret@example.test'}]},{pages:[page],screenhots:true},
  {pages:[page],navigationAttempts:4},{pages:[page],viewport:{width:0,height:720}}]) assert.throws(()=>pagesToConfig(value));
});
async function server(){
 const app=createServer((req,res)=>{
  if(req.url==='/import.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end('.btn { color: blue; }');return;}
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end(`<!doctype html><style>@import url('/import.css') layer(theme) supports(display: grid) screen;
   fbr-button{display:contents} .btn:hover { color:red } @media(min-width:4000px){.btn {height:99px}}</style>
   <fbr-button><button class="btn">One</button></fbr-button><fbr-button><button class="btn">Two</button></fbr-button>`);
 });
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${app.address().port}/`,close:()=>new Promise(resolve=>app.close(resolve))};
}
test('JSON CLI collects multiple origins and boxless hosts, and writes readable DOM/CSS without images',async()=>{
 const a=await server(),b=await server();const dir=await mkdtemp(join(tmpdir(),'pages-cli-'));
 try{
  const manifest=join(dir,'pages.json');
  await writeFile(manifest,JSON.stringify([{url:a.url,selectors:['fbr-button']},{url:b.url,selectors:['fbr-button'],viewport:{width:375,height:800}}]));
  const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
  const out=join(dir,'results');
  await promisify(execFile)(process.execPath,[cli,'--pages',manifest,'--output',out],{timeout:30000});
  const folder=join(out,(await readdir(out))[0]);
  const report=JSON.parse(await readFile(join(folder,'report.json'),'utf8'));
  assert.equal(report.captured,2);assert.equal(report.failures,0);assert.equal(report.results[0].selection[0].count,2);
  assert.equal((await readdir(folder)).some(f=>f.endsWith('.png')),false);
  const dom=JSON.parse(await readFile(join(folder,'page-002/dom.json'),'utf8'));
  assert.equal(dom.url,b.url);assert.equal(dom.viewport.width,375);assert.equal(dom.viewport.height,800);
  assert.equal(dom.targets.length,2);assert(dom.nodes.some(n=>n.tag==='fbr-button'&&n.rect.width===0));
  const css=await readFile(join(folder,'page-001/source.css'),'utf8');
  assert.match(css,/@layer theme/);assert.match(css,/@supports \(display: grid\)/);assert.match(css,/@media screen/);
  assert.match(css,/color: blue/);assert.match(css,/4000px/);assert.match(css,/:hover/);
  const candidates=await readFile(join(folder,'page-001/candidates.css'),'utf8');assert.match(candidates,/:hover/);
  assert((await readFile(join(folder,'REGENERATE.md'),'utf8')).includes('dom.json'));
 }finally{await a.close();await b.close();await rm(dir,{recursive:true,force:true});}
});
