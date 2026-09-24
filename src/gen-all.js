import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {pagesToConfig} from './pages.js';
import {run} from './run.js';
import {buildInput} from './ai/input.js';
import {prepareLocalCSS} from './local-css.js';

export const DEFAULT_PREFIXES=['fbr-','fmo-','fho-','fto-','mss-'];
const componentName=/^[a-z][a-z0-9-]*$/;

function nonemptyString(value,label){
  if(typeof value!=='string'||!value.trim())throw new Error(`${label} doit être une chaîne non vide.`);
  return value;
}
function positiveInteger(value,label){
  if(!Number.isInteger(value)||value<1)throw new Error(`${label} doit être un entier positif.`);
  return value;
}
function validURL(value,label){
  let url;try{url=new URL(value);}catch{throw new Error(`${label} doit être une URL HTTP(S).`);}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error(`${label} doit être une URL HTTP(S) sans identifiants.`);
  return url.href;
}

export function normalizeAllManifest(value,{directory=process.cwd()}={}){
  const manifest=Array.isArray(value)?{pages:value}:value;
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('Le manifeste doit être un objet ou une liste de pages.');
  const allowed=['project','pages','prefixes','viewport','timeout','navigationAttempts','storageState'];
  for(const key of Object.keys(manifest))if(!allowed.includes(key))throw new Error(`Option inconnue : ${key}`);
  if(!Array.isArray(manifest.pages)||!manifest.pages.length)throw new Error('pages doit contenir au moins une page.');
  const prefixes=manifest.prefixes??DEFAULT_PREFIXES;
  if(!Array.isArray(prefixes)||!prefixes.length||prefixes.some(p=>typeof p!=='string'||!/^[a-z][a-z0-9]*-$/.test(p)))
    throw new Error('prefixes doit contenir des préfixes de tags comme "fbr-".');
  const vp=manifest.viewport??{width:1280,height:720};
  positiveInteger(vp.width,'viewport.width');positiveInteger(vp.height,'viewport.height');
  const timeout=positiveInteger(manifest.timeout??60000,'timeout');
  const navigationAttempts=positiveInteger(manifest.navigationAttempts??3,'navigationAttempts');
  if(navigationAttempts>3)throw new Error('navigationAttempts doit être au plus 3.');
  const pages=manifest.pages.map((entry,index)=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error(`pages[${index}] doit être un objet.`);
    for(const key of Object.keys(entry))if(!['name','url','waitFor','viewport','selectors'].includes(key))throw new Error(`pages[${index}].${key} : option inconnue.`);
    const viewport=entry.viewport??vp;
    positiveInteger(viewport.width,`pages[${index}].viewport.width`);
    positiveInteger(viewport.height,`pages[${index}].viewport.height`);
    if(entry.waitFor!==undefined)nonemptyString(entry.waitFor,`pages[${index}].waitFor`);
    // Existing page manifests can be reused. Their target selectors do not limit
    // this full-document inventory; the generation pass targets each tag itself.
    if(entry.selectors!==undefined&&(!Array.isArray(entry.selectors)||entry.selectors.some(s=>typeof s!=='string'||!s.trim())))
      throw new Error(`pages[${index}].selectors doit être une liste de chaînes.`);
    return {name:entry.name?nonemptyString(entry.name,`pages[${index}].name`):`page-${index+1}`,
      url:validURL(entry.url,`pages[${index}].url`),viewport,
      ...(entry.waitFor?{waitFor:entry.waitFor}:{})};
  });
  return {project:manifest.project?nonemptyString(manifest.project,'project'):'chromatic-gen-all',
    prefixes:[...new Set(prefixes)],pages,timeout,navigationAttempts,
    storageState:manifest.storageState?resolve(directory,nonemptyString(manifest.storageState,'storageState')):null};
}

export async function loadAllManifest(filename){
  const absolute=resolve(filename);
  return normalizeAllManifest(JSON.parse(await readFile(absolute,'utf8')),{directory:dirname(absolute)});
}

export async function inventoryAll(manifest,{headed=false,log=console.log}={}){
  const browser=await chromium.launch({headless:!headed});
  const results=[];
  try{
    for(let index=0;index<manifest.pages.length;index++){
      const source=manifest.pages[index],result={...source,status:'failed'};
      let context;
      try{
        context=await browser.newContext({viewport:source.viewport,
          ...(manifest.storageState?{storageState:manifest.storageState}:{})});
        context.setDefaultTimeout(manifest.timeout);
        context.setDefaultNavigationTimeout(manifest.timeout);
        const page=await context.newPage();
        for(let attempt=1;attempt<=manifest.navigationAttempts;attempt++){
          const response=await page.goto(source.url,{waitUntil:'domcontentloaded'});
          if(!response||![401,403,429,502,503,504].includes(response.status())||attempt===manifest.navigationAttempts){
            if(response&&response.status()>=400)throw new Error(`HTTP ${response.status()}`);
            break;
          }
          await new Promise(done=>setTimeout(done,1000*attempt));
        }
        const destination=new URL(page.url()),origin=new URL(source.url);
        if((origin.hostname.endsWith('.chromatic.com')&&destination.hostname!==origin.hostname)||
          /\/(?:sign-?in|login)(?:\/|$)/i.test(destination.pathname))
          throw new Error('La page a redirigé vers une connexion ou hors du build Chromatic.');
        if(source.waitFor)await page.locator(source.waitFor).first().waitFor({state:'attached'});
        await page.waitForFunction(prefixes=>[...document.querySelectorAll('*')].some(element=>
          prefixes.some(prefix=>element.localName.startsWith(prefix))),manifest.prefixes);
        await page.waitForFunction(()=>!document.fonts||document.fonts.status==='loaded');
        result.components=await page.evaluate(prefixes=>{
          const found=new Map();
          for(const element of document.querySelectorAll('*')){
            const tag=element.localName;
            if(!prefixes.some(prefix=>tag.startsWith(prefix)))continue;
            const parent=element.parentElement;
            const classes=[...element.classList].sort();
            const parentClasses=parent?[...parent.classList].sort():[];
            const theme=['cfcal','btbnc','fhome'].filter(c=>element.closest(`.${c}`));
            const details={classes,parentTag:parent?.localName||null,parentClasses,theme};
            const signature=JSON.stringify(details);
            if(!found.has(tag))found.set(tag,{tag,count:0,variants:new Map()});
            const item=found.get(tag);item.count++;
            if(!item.variants.has(signature))item.variants.set(signature,{selector:tag+classes.map(c=>`.${CSS.escape(c)}`).join(''),...details,count:0});
            item.variants.get(signature).count++;
          }
          return [...found.values()].sort((a,b)=>a.tag.localeCompare(b.tag)).map(({tag,count,variants})=>({tag,count,selector:tag,variants:[...variants.values()]}));
        },manifest.prefixes);
        if(!result.components.length)throw new Error('Aucun composant des préfixes demandés trouvé dans le DOM.');
        result.status='captured';result.url=page.url();
      }catch(error){result.error=error.message;}
      finally{await context?.close();}
      results.push(result);
      log(`[${index+1}/${manifest.pages.length}] inventaire ${result.status} — ${source.name}${result.error?` : ${result.error}`:''}`);
    }
  }finally{await browser.close();}
  const componentMap=new Map();
  for(const page of results.filter(p=>p.status==='captured'))for(const component of page.components){
    if(!componentMap.has(component.tag))componentMap.set(component.tag,{tag:component.tag,selector:component.tag,instances:0,pages:[]});
    const item=componentMap.get(component.tag);item.instances+=component.count;
    item.pages.push({name:page.name,url:page.url,viewport:page.viewport,count:component.count,variants:component.variants});
  }
  return {format:'chromatic-component-inventory-v1',project:manifest.project,prefixes:manifest.prefixes,
    status:results.some(p=>p.status==='failed')?'incomplete':'complete',pages:results,
    components:[...componentMap.values()].sort((a,b)=>a.tag.localeCompare(b.tag))};
}

export async function collectComponent(manifest,component,{outputRoot,headed=false,log=console.log}={}){
  if(!componentName.test(component.tag)||!manifest.prefixes.some(prefix=>component.tag.startsWith(prefix)))
    throw new Error(`Nom de composant invalide : ${component.tag}`);
  const byPage=new Map(manifest.pages.map(p=>[`${p.name}\n${p.url}`,p]));
  const pageManifest={project:`${manifest.project}-${component.tag}`,timeout:manifest.timeout,
    navigationAttempts:manifest.navigationAttempts,screenshots:false,
    ...(manifest.storageState?{storageState:manifest.storageState}:{}),
    pages:component.pages.map(p=>{
      const source=byPage.get(`${p.name}\n${p.url}`);
      return {name:p.name,url:p.url,viewport:p.viewport,selectors:[component.tag],
        ...(source?.waitFor?{waitFor:source.waitFor}:{})};
    })};
  const config=pagesToConfig(pageManifest,{directory:process.cwd()});
  const collected=await run(config,{headed,outputRoot,log});
  if(collected.failed)throw new Error(`Collecte incomplète : ${collected.output}`);
  const input=buildInput(collected.archive,component.tag),local=prepareLocalCSS(input);
  const localPath=join(collected.output,'local-css',component.tag);
  await mkdir(localPath,{recursive:true});
  await Promise.all([
    writeFile(join(localPath,`${component.tag}.safe.css`),local.css),
    writeFile(join(localPath,'ambiguous.json'),JSON.stringify({component:component.tag,definitions:local.ambiguous},null,2)),
    writeFile(join(localPath,'report.json'),JSON.stringify(local.report,null,2))
  ]);
  return {archive:join(collected.output,'archive.json'),localPath,report:local.report};
}
