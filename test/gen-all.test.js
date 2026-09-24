import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {normalizeAllManifest,inventoryAll} from '../src/gen-all.js';

test('gen-all manifest accepts URL-only pages and rejects invalid input',()=>{
  const manifest=normalizeAllManifest({pages:[{url:'https://example.test/story'}],prefixes:['fbr-']});
  assert.deepEqual(manifest.pages[0].viewport,{width:1280,height:720});
  assert.equal(manifest.pages[0].name,'page-1');
  assert.throws(()=>normalizeAllManifest({pages:[{url:'file:///tmp/page.html'}]}),/HTTP/);
  assert.throws(()=>normalizeAllManifest({pages:[{url:'https://example.test'}],prefixes:['fbr']}),/préfixes/);
});

test('inventory groups host variants and gen-all writes a CSS file per observed component without AI',async()=>{
  const server=createServer((request,response)=>{
    response.writeHead(200,{'content-type':'text/html'});
    response.end(`<!doctype html><html><head><style>
      fbr-button { display: inline-block; }
      fbr-button.primary { color: red; }
      fmo-card { display: block; }
    </style></head><body>
      <fbr-button class="primary"><button>One</button></fbr-button>
      <fbr-button class="secondary"><button>Two</button></fbr-button>
      <fmo-card><div>Card</div></fmo-card>
    </body></html>`);
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const root=await mkdtemp(join(tmpdir(),'css-gen-all-'));
  try{
    const url=`http://127.0.0.1:${server.address().port}/`;
    const raw={project:'test-all',prefixes:['fbr-','fmo-'],pages:[{name:'first',url}]};
    const manifest=normalizeAllManifest(raw),inventory=await inventoryAll(manifest,{log:()=>{}});
    assert.equal(inventory.status,'complete');
    assert.deepEqual(inventory.components.map(c=>c.tag),['fbr-button','fmo-card']);
    assert.equal(inventory.components[0].instances,2);
    assert.equal(inventory.pages[0].components[0].variants.length,2);
    assert.equal(inventory.components[0].selector,'fbr-button');
    const manifestPath=join(root,'pages.json'),output=join(root,'out');
    await writeFile(manifestPath,JSON.stringify(raw));
    const cli=fileURLToPath(new URL('../src/gen-all-cli.js',import.meta.url));
    await promisify(execFile)(process.execPath,[cli,'--pages',manifestPath,'--output',output],{timeout:60000});
    const summary=JSON.parse(await readFile(join(output,'summary.json'),'utf8'));
    assert.deepEqual(summary.components.map(c=>c.component),['fbr-button','fmo-card']);
    assert(summary.components.every(c=>c.status==='local'));
    for(const row of summary.components){
      const css=await readFile(row.localCSS,'utf8');
      assert.match(css,/:host/);
      const folder=join(output,'components',row.component,'collect');
      assert.equal((await readdir(folder)).length,1);
    }
    assert.equal(summary.components[0].ambiguousRules,0);
    assert.deepEqual(summary.usage,{});
    const completeOutput=join(root,'complete');
    try{
      await promisify(execFile)(process.execPath,[cli,'--inventory',join(output,'inventory.json'),
        '--output',completeOutput,'--only','fmo-card','--complete'],{timeout:60000});
    }catch(error){if(error.code!==2)throw error;}
    const complete=JSON.parse(await readFile(join(completeOutput,'summary.json'),'utf8'));
    assert.equal(complete.components.length,1);
    assert.equal(complete.components[0].status,'needs_review');
    assert.match(await readFile(complete.components[0].css,'utf8'),/:host/);
  }finally{
    await new Promise(done=>server.close(done));
    await rm(root,{recursive:true,force:true});
  }
});
