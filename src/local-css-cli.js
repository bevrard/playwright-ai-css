#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {locateArchive} from './ai/run.js';
import {buildInput} from './ai/input.js';
import {prepareLocalCSS} from './local-css.js';

try{
  const {values}=parseArgs({options:{input:{type:'string'},component:{type:'string'},output:{type:'string'}}});
  const archivePath=await locateArchive(values.input),archive=JSON.parse(await readFile(archivePath,'utf8'));
  const input=buildInput(archive,values.component),prepared=prepareLocalCSS(input);
  const output=resolve(values.output||join(dirname(archivePath),'local-css',prepared.component));await mkdir(output,{recursive:true});
  await Promise.all([
    writeFile(join(output,`${prepared.component}.safe.css`),prepared.css),
    writeFile(join(output,'ambiguous.json'),JSON.stringify({component:prepared.component,definitions:prepared.ambiguous},null,2)),
    writeFile(join(output,'report.json'),JSON.stringify(prepared.report,null,2))
  ]);
  console.log(`CSS local sûr : ${output}/${prepared.component}.safe.css\nRègles sûres : ${prepared.report.safe}/${prepared.report.required}; ambiguës : ${prepared.report.ambiguous}\nDossier ambigu : ${output}/ambiguous.json`);
}catch(error){console.error(error.message);process.exitCode=1;}
