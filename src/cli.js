import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './run.js';
import { loadPages } from './pages.js';
const args=process.argv.slice(2);
let configFile,pagesFile,headed=false,outputRoot='artifacts';
try {
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--headed') headed=true;
    else if(args[i]==='--config'&&args[i+1]) configFile=args[++i];
    else if(args[i]==='--pages'&&args[i+1]) pagesFile=args[++i];
    else if(args[i]==='--output'&&args[i+1]) outputRoot=args[++i];
    else if(args[i]==='--help') {
      console.log('Usage: npm run collect -- [--pages pages.json] [--output artifacts] [--headed]\nMode avancé : --config scenarios.config.mjs (exclusif avec --pages).');
      process.exit(0);
    } else throw new Error(`Argument inconnu ou incomplet : ${args[i]}`);
  }
  if(configFile&&pagesFile) throw new Error('Choisir --pages ou --config, pas les deux.');
  const config=configFile?(await import(pathToFileURL(resolve(configFile)).href)).default:await loadPages(resolve(pagesFile||'pages.json'));
  const result=await run(config,{headed,outputRoot});
  console.log(`Résultats : ${result.output}`);
  if(result.failed) process.exitCode=1;
} catch(e) {console.error(e.message);process.exitCode=1;}
