#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compareArchives} from './style-diff.js';

try{
  const {values}=parseArgs({options:{before:{type:'string'},after:{type:'string'},output:{type:'string'}}});
  if(!values.before||!values.after)throw new Error('Utilisation : npm run css:compare -- --before AVANT/archive.json --after APRES/archive.json');
  const load=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
  const report=compareArchives(await load(values.before),await load(values.after));
  const output=resolve(values.output||'style-diff.json');await writeFile(output,JSON.stringify(report,null,2));
  console.log(`${report.status==='equal'?'Styles identiques':report.status==='insufficient'?'Comparaison insuffisante':'Différences détectées'} : ${report.differenceCount} propriété(s), ${report.missing.length} nœud/capture manquant(s).\nRapport : ${output}`);
  process.exitCode=report.status==='equal'?0:report.status==='different'?2:1;
}catch(error){console.error(error.message);process.exitCode=1;}
