import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fail=message=>{throw new Error(`Fichier de pages : ${message}`);};
function object(value,label,allowed) {
  if(!value || typeof value!=='object' || Array.isArray(value)) fail(`${label} doit être un objet.`);
  for(const key of Object.keys(value)) if(!allowed.includes(key)) fail(`${label}.${key} : option inconnue.`);
}
function strings(value,label) {
  if(!Array.isArray(value)||!value.length||value.some(s=>typeof s!=='string'||!s.trim())) fail(`${label} doit être une liste non vide de chaînes.`);
  return value;
}
function integer(value,label,min=1,max=Number.MAX_SAFE_INTEGER) {
  if(!Number.isInteger(value)||value<min||value>max) fail(`${label} doit être un entier entre ${min} et ${max}.`);
  return value;
}
function viewport(value,label) {
  object(value,label,['width','height']);
  return {width:integer(value.width,`${label}.width`),height:integer(value.height,`${label}.height`)};
}
export function pagesToConfig(input,{directory=process.cwd()}={}) {
  const manifest=Array.isArray(input)?{pages:input}:input;
  object(manifest,'racine',['project','pages','viewport','widths','timeout','navigationAttempts','includeText','screenshots','storageState','stopPrefixes','ionicSheetURLs']);
  if(!Array.isArray(manifest.pages)||!manifest.pages.length) fail('pages doit contenir au moins une page.');
  const vp=viewport(manifest.viewport||{width:1280,height:720},'viewport');
  const widths=manifest.widths||[vp.width];
  if(!Array.isArray(widths)||!widths.length) fail('widths doit être une liste non vide.');
  widths.forEach(w=>integer(w,'widths'));
  for(const option of ['includeText','screenshots']) if(manifest[option]!==undefined&&typeof manifest[option]!=='boolean')fail(`${option} doit être un booléen.`);
  if(manifest.project!==undefined&&(typeof manifest.project!=='string'||!manifest.project.trim()))fail('project doit être un nom non vide.');
  if(manifest.storageState!==undefined&&(typeof manifest.storageState!=='string'||!manifest.storageState.trim()))fail('storageState doit être un chemin.');
  for(const key of ['stopPrefixes','ionicSheetURLs']) if(manifest[key]!==undefined){
    if(!Array.isArray(manifest[key])||manifest[key].some(s=>typeof s!=='string'||!s.trim()))fail(`${key} doit être une liste de chaînes.`);
  }
  const scenarios=manifest.pages.map((entry,index)=>{
    const label=`pages[${index}]`;
    object(entry,label,['name','url','selectors','waitFor','viewport','includeText']);
    let url;try{url=new URL(entry.url);}catch{fail(`${label}.url doit être une URL absolue HTTP(S).`);}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail(`${label}.url doit être une URL HTTP(S) sans identifiants intégrés.`);
    const selectors=strings(entry.selectors,`${label}.selectors`);
    if(entry.name!==undefined&&(typeof entry.name!=='string'||!entry.name.trim()))fail(`${label}.name doit être une chaîne non vide.`);
    if(entry.waitFor!==undefined&&(typeof entry.waitFor!=='string'||!entry.waitFor.trim()))fail(`${label}.waitFor doit être un sélecteur CSS.`);
    if(entry.includeText!==undefined&&typeof entry.includeText!=='boolean')fail(`${label}.includeText doit être un booléen.`);
    const pageVP=entry.viewport?viewport(entry.viewport,`${label}.viewport`):null;
    return {name:entry.name||`page-${index+1}`,path:url.href,
      ...(pageVP?{widths:[pageVP.width],height:pageVP.height}:{}),
      collector:{selectors,includeText:entry.includeText??manifest.includeText??false},
      prepare:async page=>{
        if(entry.waitFor) await page.locator(entry.waitFor).first().waitFor({state:'attached'});
        for(const selector of selectors) await page.locator(selector).first().waitFor({state:'attached'});
      }};
  });
  return {project:manifest.project||'css-regeneration',baseURL:new URL(scenarios[0].path).origin,
    widths,height:vp.height,timeout:integer(manifest.timeout??60000,'timeout'),
    navigationAttempts:integer(manifest.navigationAttempts??3,'navigationAttempts',1,3),
    screenshots:manifest.screenshots??false,
    context:manifest.storageState?{storageState:resolve(directory,manifest.storageState)}:{},
    collector:{...(manifest.stopPrefixes?{stopPrefixes:manifest.stopPrefixes}:{}),
      ...(manifest.ionicSheetURLs?{ionicSheetURLs:manifest.ionicSheetURLs}:{})},scenarios};
}
export async function loadPages(filename) {
  let data;try{data=JSON.parse(await readFile(filename,'utf8'));}catch(e){throw new Error(`Impossible de lire ${filename} : ${e.message}`);}
  return pagesToConfig(data,{directory:dirname(resolve(filename))});
}
