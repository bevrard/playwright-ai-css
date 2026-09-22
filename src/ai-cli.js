#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {runAI} from './ai/run.js';

try {
  const {values:v}=parseArgs({options:{
    provider:{type:'string'},input:{type:'string'},component:{type:'string'},model:{type:'string'},effort:{type:'string'},prompt:{type:'string'},output:{type:'string'},
    'dry-run':{type:'boolean'},'max-input-chars':{type:'string'},'timeout-ms':{type:'string'},help:{type:'boolean',short:'h'}
  }});
  if(v.help){console.log(`Usage : npm run ia:codex -- [options]
        npm run ia:claude -- [options]
        npm run ia:gemini -- [options]
        npm run ia:mistral-vibe -- [options]

--input DOSSIER|archive.json   Par défaut : collecte la plus récente dans artifacts
--component fbr-button        Déduit si un seul composant ciblé
--prompt FICHIER.md            Remplace le prompt de régénération
--model IDENTIFIANT            Remplace le modèle par défaut
--effort NIVEAU                Effort Codex : none, minimal, low, medium, high, xhigh ou max
--dry-run                      Prépare les données, aucun lancement du CLI
--max-input-chars 600000       Garde-fou de taille, jamais de troncature
--timeout-ms 1200000           Délai maximal du CLI (20 min)
--output DOSSIER               Racine des nouveaux dossiers IA

Codes : 0 prêt/généré, 1 échec, 2 CSS produit avec points à vérifier.
Authentification existante : claude /login, codex login, gemini ou mistral-vibe. Aucune clé API ni .env requis.`);}
  else {
    const result=await runAI({...v,dryRun:v['dry-run'],maxInputChars:v['max-input-chars']===undefined?undefined:Number(v['max-input-chars']),timeout:v['timeout-ms']===undefined?undefined:Number(v['timeout-ms'])});
    process.exitCode=result.exitCode;
  }
}catch(e){console.error(e.message);process.exitCode=1;}
