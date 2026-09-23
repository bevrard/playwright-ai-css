import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { collectPage } from './selector-probes.js';
import { append, compact } from './exporter.js';
import { writeReadable } from './readable.js';
import { collectMatchedStyles } from './cdp-styles.js';

export async function run(config, { headed = false, outputRoot = 'artifacts', log = console.log } = {}) {
  const navigationAttempts=config.navigationAttempts || 1;
  if (!Number.isInteger(navigationAttempts) || navigationAttempts < 1 || navigationAttempts > 3)
    throw new Error('navigationAttempts doit être compris entre 1 et 3.');
  if (!config.scenarios?.length) throw new Error('Configurer au moins un scénario.');
  for (const scenario of config.scenarios) {
    const states = scenario.states || [{name:'normal'}];
    if (!scenario.name || !scenario.path || !states.length || states.some(s => !s.name) ||
        new Set(states.map(s => s.name)).size !== states.length)
      throw new Error('Chaque scénario doit avoir un nom, un path et des états nommés uniques.');
    if (scenario.targets && (!scenario.targets.length || scenario.targets.some(t => !t.name || !t.selector) ||
        new Set(scenario.targets.map(t => t.name)).size !== scenario.targets.length))
      throw new Error('Chaque cible doit avoir un nom unique et un sélecteur CSS.');
  }
  const widths = config.widths || [375, 1024, 1440];
  if (!widths.length || widths.some(w => !Number.isInteger(w) || w < 1)) throw new Error('Largeurs invalides.');
  const plannedCases = config.scenarios.flatMap((scenario, index) => (scenario.widths || widths).flatMap(width =>
    (scenario.states || [{name:'normal'}]).map(state => ({scenario:index,name:scenario.name,state:state.name,width,height:scenario.height||config.height||900}))));
  if (!plannedCases.length) throw new Error('Aucun état configuré.');
  const output = resolve(outputRoot, new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(output, {recursive:true});
  const archive = {version:1,project:config.project || 'css-audit',dictionary:[],captures:[],plannedCases,
    limitations:[
      'DOM et styles chargés au moment des captures ; aucune garantie sur les états non visités.',
      'CSSOM accessible uniquement : CORS, shadow roots, iframe et styles navigateur limitent la couverture.',
      'Frontières configurées non traversées. Frères du chemin ancestral décrits sans leur sous-arbre.',
      'Dossier IA filtré de manière heuristique ; les règles omises restent dans l’archive.',
      'Propriétés calculées : observation ponctuelle, pas résolution de la provenance des gagnants.',
      'Captures d’écran de référence uniquement : aucune comparaison avant/après effectuée.',
    ]};
  const results = [];
  await writeFile(join(output,'REGENERATE.md'),`# Préparer la régénération CSS\n\nCommencer par report.json pour connaître les pages capturées et les échecs.\n\nPour chaque page capturée, lire page-NNN/dom.json et candidates.css. Les identifiants de règle renvoient à l’archive. Consulter source.css et sources.json si une dépendance manque, computed.json pour les valeurs observées. ai-context.json propose une représentation compacte de l’ensemble ; archive.json conserve les sources accessibles.\n\nPréserver les variantes entre pages, l’ordre des règles, les conditions, les variables et les frontières Angular. Les fichiers CSS exportés servent à l’analyse : ils ne sont pas encore convertis en :host et ne sont pas des styles finaux à appliquer. Interpréter les URL relatives selon la baseURL de chaque feuille. Ne pas confondre une observation avec une couverture exhaustive des états. Signaler les incertitudes avant de proposer la régénération. Aucune IA n’a été appelée par cette collecte.\n`);
  async function checkpoint() {
    const ai=compact(archive);
    const report={project:archive.project,planned:plannedCases.length,observations:archive.captures.length,
      captured:results.filter(r=>r.status==='captured').length,
      failures:results.filter(r=>r.status==='failed').length,results,
      sizes:{archiveCharacters:JSON.stringify(archive).length,aiCharacters:JSON.stringify(ai).length},
      note:'Les tailles sont en caractères, pas en tokens. Chaque statut captured vérifie la présence des sélecteurs, pas la fidélité visuelle.'};
    for(const [name,data] of [['archive.json',archive],['ai-context.json',ai],['report.json',report]]) {
      const tmp=join(output,name+'.tmp');
      await writeFile(tmp,JSON.stringify(data,null,name==='ai-context.json'?0:2));
      await rename(tmp,join(output,name));
    }
  }
  let service,browser;
  try {
    service=await config.start?.();
    const baseURL=service?.baseURL || config.baseURL;
    if(!baseURL) throw new Error('Définir APP_URL ou baseURL dans scenarios.config.mjs. Exemple : APP_URL=http://localhost:4200 npm run collect');
    const base=new URL(baseURL);
    if(!['http:','https:'].includes(base.protocol)) throw new Error('baseURL doit utiliser HTTP(S).');
    browser=await chromium.launch({headless:!headed});
    for(let i=0;i<plannedCases.length;i++) {
      const item=plannedCases[i], scenario=config.scenarios[item.scenario];
      const state=(scenario.states||[{name:'normal'}]).find(s=>s.name===item.state);
      let context,page;
      const result={...item,status:'failed'};
      try {
        // Un contexte neuf par cas évite le cumul des états et du stockage applicatif.
        context=await browser.newContext({...config.context,baseURL,
          viewport:{width:item.width,height:item.height}});
        context.setDefaultTimeout(config.timeout||15000);
        context.setDefaultNavigationTimeout(config.timeout||15000);
        page=await context.newPage();
        const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
        await config.setup?.(page,context);
        let response;
        result.navigations=[];
        for (let attempt=1;attempt<=navigationAttempts;attempt++) {
          response=await page.goto(new URL(scenario.path,baseURL).href,{waitUntil:'domcontentloaded'});
          result.navigations.push({attempt,status:response?.status(),url:page.url()});
          if (!response || ![401,403,429,502,503,504].includes(response.status()) || attempt===navigationAttempts) break;
          await new Promise(resolve=>setTimeout(resolve,1000*attempt));
        }
        if(response && response.status()>=400) throw new Error(`HTTP ${response.status()}`);
        await scenario.prepare?.(page);
        await state.prepare?.(page);
        await page.waitForFunction(()=>!document.fonts||document.fonts.status==='loaded');
        await scenario.ready?.(page,state);
        const options={...config.collector,...scenario.collector};
        if (scenario.targets) {
          options.selectors = scenario.targets.map(t => t.selector);
          for (const target of scenario.targets) {
            await page.locator(target.selector).first().waitFor({state:'attached'});
            const count = await page.locator(target.selector).count();
            if (count !== 1) throw new Error(`Cible ${target.name} : ${count} éléments (1 attendu).`);
            if(config.screenshots!==false){
              const visual=page.locator(target.screenshotSelector || target.selector);
              await visual.first().waitFor({state:'visible'});
              if (await visual.count() !== 1) throw new Error(`Image ${target.name} : sélecteur visuel ambigu.`);
            }
          }
        }
        const snapshot=await collectPage(page,{options,label:`${scenario.name} / ${state.name}`});
        if(config.matchedStyles!==false){
          try{snapshot.matchedStyles=await collectMatchedStyles(page,snapshot);}
          catch(error){snapshot.warnings.push(`Styles CDP indisponibles : ${error.message}`);}
        }
        snapshot.scenario=item;
        snapshot.targetDefinitions=scenario.targets;
        snapshot.pageErrors=pageErrors;
        append(archive,snapshot);
        result.captureID=snapshot.id;
        result.files=await writeReadable(output,archive,snapshot);
        const missing=snapshot.selection.filter(s=>!s.count).map(s=>s.selector);
        if(missing.length) throw new Error(`Aucun élément pour : ${missing.join(', ')}`);
        // Capture avant export sans annuler les animations : l’observation reste fidèle à l’état présent.
        result.selection=snapshot.selection;
        if(config.screenshots!==false){
        const image=`case-${String(i+1).padStart(3,'0')}.png`;
        await page.screenshot({path:join(output,image),fullPage:true});
        result.targets=[];
        for (const [targetIndex, target] of (scenario.targets || []).entries()) {
          const targetImage=`case-${String(i+1).padStart(3,'0')}-target-${String(targetIndex+1).padStart(2,'0')}.png`;
          const locator=page.locator(target.screenshotSelector || target.selector);
          if (await locator.count() !== 1) throw new Error(`Cible ${target.name} modifiée pendant la capture.`);
          await locator.screenshot({path:join(output,targetImage)});
          result.targets.push({name:target.name,selector:target.selector,
            screenshotSelector:target.screenshotSelector || target.selector,screenshot:targetImage,
            text:(await locator.innerText()).trim()});
        }
        snapshot.screenshots={page:image,targets:result.targets};
        result.screenshot=image;
        }
        result.status='captured';result.url=page.url();
        result.warnings=snapshot.warnings;
      } catch(e) {
        result.error=e.message;
        if (page && !page.isClosed() && config.screenshots!==false) {
          result.url=page.url();
          const image=`case-${String(i+1).padStart(3,'0')}-failure.png`;
          try {await page.screenshot({path:join(output,image),timeout:5000});result.failureScreenshot=image;} catch {}
        }
      }
      finally {await context?.close();}
      results.push(result);
      log(`[${i+1}/${plannedCases.length}] ${result.status} — ${item.name} / ${item.state} / ${item.width}px${result.error?' : '+result.error:''}`);
      await checkpoint();
    }
  } finally {
    await browser?.close();
    await service?.stop?.();
    await checkpoint();
  }
  return {output,archive,results,failed:results.some(r=>r.status==='failed')};
}
