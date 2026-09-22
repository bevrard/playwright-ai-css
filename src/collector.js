/** Serializable browser collector. No storage, navigation, network or CSS mutation. */
export function collectInBrowser({ options = {}, label = 'normal' } = {}) {
  const {selectorProbes:parsedProbes,...settings}=options;
  const CONFIG = {
    selectors: ['fbr-button'],
    stopPrefixes: ['fbr-', 'fmo-', 'fho-', 'mss-', 'fto-'],
    ionicSheetURLs: [], includeText: false, ...settings
  };
  if (!Array.isArray(CONFIG.selectors) || !CONFIG.selectors.length)
    throw new Error('Provide at least one CSS selector');
  function splitSelectors(s) {
    let start=0, depth=0, quote=''; const result=[];
    for(let i=0;i<s.length;i++) {
      const c=s[i]; if(c==='\\') { i++; continue; }
      if(quote) { if(c===quote) quote=''; continue; }
      if(c==='"'||c==="'") {quote=c;continue;}
      if(c==='('||c==='[') depth++;
      if(c===')'||c===']') depth--;
      if(c===','&&!depth) {result.push(s.slice(start,i).trim());start=i+1;}
    }
    result.push(s.slice(start).trim()); return result;
  }
  function probeSelector(s) {
    if(parsedProbes&&Object.prototype.hasOwnProperty.call(parsedProbes,s))return parsedProbes[s];
    // Uniquement les pseudos simples hors attributs : jamais de regex sur :is/:not/:has.
    if (/[()\\|&]/.test(s)) return null;
    let out='', bracket=0, quote='';
    for(let i=0;i<s.length;i++) {
      const c=s[i];
      if(quote) {out+=c;if(c===quote) quote='';continue;}
      if(c==='"'||c==="'") {quote=c;out+=c;continue;}
      if(c==='[') bracket++; if(c===']') bracket--;
      if(c===':'&&!bracket) {
        const m=s.slice(i).match(/^::?[\w-]+/);
        if(!m) return null;
        if(!out || /[\s>+~]$/.test(out)) out+='*';
        i+=m[0].length-1;
      } else out+=c;
    }
    return out;
  }
  function observe(label) {
    const warnings=[], nodes=[], nodeIDs=new Map(), measured=new Set();
    const targets=[], selection=[];
    const add = el => {
      if(nodeIDs.has(el)) return nodeIDs.get(el);
      const id=nodes.length; nodeIDs.set(el,id);
      const attrs={};
      for(const a of el.attributes) if(a.name!=='value'&&a.name!=='srcdoc'&&!a.name.startsWith('on')) attrs[a.name]=a.value;
      nodes.push({id, tag:el.localName, attrs, parent:null, children:[],
        childElementCount:el.childElementCount, childNodeCount:el.childNodes.length,
        text:CONFIG.includeText ? [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('') : undefined,
        states:Object.fromEntries(['hover','active','focus','focus-visible','focus-within','disabled','checked','indeterminate'].map(s=>{
          try{return [s,el.matches(':'+s)];}catch{return [s,null];}
        }))});
      return id;
    };
    function walk(el, root) {
      const id=add(el); measured.add(el);
      if(el.shadowRoot || el.localName==='iframe') warnings.push(`Frontière non explorée : ${el.localName} (n${id})`);
      if(el!==root&&CONFIG.stopPrefixes.some(p=>el.localName.startsWith(p))) {nodes[id].boundary=true;return;}
      for(const child of el.children) walk(child,root);
    }
    for(const selector of CONFIG.selectors) {
      let found;
      try{found=[...document.querySelectorAll(selector)];}catch(e){throw new Error(`Sélecteur invalide ${selector}: ${e.message}`);}
      selection.push({selector,count:found.length});
      for(const root of found) {
        walk(root,root); const id=add(root); targets.push({selector,node:id});
        for(let el=root;el;el=el.parentElement) {
          add(el);
          if(el.parentElement) {add(el.parentElement);for(const sibling of el.parentElement.children) add(sibling);}
        }
      }
    }
    if(!targets.length) warnings.push('Aucun élément cible présent : capture conservée pour le suivi de couverture.');
    for(const [el,id] of nodeIDs) {
      const n=nodes[id]; n.parent=nodeIDs.get(el.parentElement)??null;
      n.children=[...el.children].filter(c=>nodeIDs.has(c)).map(c=>nodeIDs.get(c));
      n.childrenComplete=n.children.length===el.childElementCount;
      if(measured.has(el) || targets.some(t=>t.node===id) || [...measured].some(m=>el.contains(m))) {
        const style=getComputedStyle(el);
        n.computed=Object.fromEntries([...style].map(p=>[p,style.getPropertyValue(p)]));
        const r=el.getBoundingClientRect(); n.rect={x:r.x,y:r.y,width:r.width,height:r.height};
        n.scroll={width:el.scrollWidth,height:el.scrollHeight};
        if(measured.has(el)) {
          n.pseudos={};
          for(const pseudo of ['::before','::after','::marker']) {
            const ps=getComputedStyle(el,pseudo);
            n.pseudos[pseudo]=Object.fromEntries([...ps].map(p=>[p,ps.getPropertyValue(p)]));
          }
        }
      }
    }
    const angularHosts={};
    for(const el of document.querySelectorAll('*')) for(const a of el.attributes) if(a.name.startsWith('_nghost-')) {
      angularHosts[a.name]??=[]; if(!angularHosts[a.name].includes(el.localName)) angularHosts[a.name].push(el.localName);
    }
    const ownAttrs=new Set([...measured].flatMap(el=>[...el.attributes].map(a=>a.name).filter(a=>a.startsWith('_ng'))));
    const contextElements=[...nodeIDs.keys()];
    const targetTags=new Set(targets.map(t=>nodes[t.node]?.tag).filter(Boolean));
    const mentionsTargetTag=s=>[...targetTags].some(tag=>new RegExp(`(^|[^\\w-])${tag.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}([^\\w-]|$)`,'i').test(s));
    function classify(selector) {
      const branches=[];
      for(const s of splitSelectors(selector)) {
        const matched=[];
        for(const el of contextElements) {try{if(el.matches(s)) matched.push(nodeIDs.get(el));}catch{}}
        if(matched.length) {branches.push({selector:s,reason:'matches-current-context',nodes:matched});continue;}
        if([...ownAttrs].some(a=>s.includes(`[${a}]`))) {branches.push({selector:s,reason:'angular-scope'});continue;}
        // Keep variants that name the component even when their state/optional leaf
        // is absent from this particular DOM (for example an empty span + icon).
        if(mentionsTargetTag(s)) {branches.push({selector:s,reason:'mentions-target-component'});continue;}
        const probe=probeSelector(s);
        if(probe===null) {branches.push({selector:s,reason:'uncertain-selector'});continue;}
        try {
          document.documentElement.matches(probe);
          const possible=contextElements.filter(el=>el.matches(probe)).map(el=>nodeIDs.get(el));
          if(possible.length) branches.push({selector:s,reason:'possible-state',nodes:possible});
        } catch {branches.push({selector:s,reason:'unsupported-selector'});}
      }
      return branches;
    }
    const sheets=[], rules=[], stack=new Set();
    function scan(s,parentImport=null) {
      if(!s) {warnings.push('Import sans feuille CSS accessible');return null;}
      if(stack.has(s)) {warnings.push('Cycle @import');return null;}
      stack.add(s);
      const sheetID=sheets.length;
      sheets.push({id:sheetID,href:s.href,baseURL:s.href||document.baseURI,disabled:s.disabled,
        media:s.media?.mediaText||'',ionic:CONFIG.ionicSheetURLs.includes(s.href),parentImport});
      function walkRules(list,parent=null) {
        for(let position=0;position<list.length;position++) {
          const rule=list[position], id=rules.length;
          const item={id,sheet:sheetID,parent,position,type:rule.type,kind:rule.constructor.name};
          rules.push(item);
          if(rule.type===3) {
            item.css=rule.cssText;item.importMedia=rule.media?.mediaText||'';
            item.importSupports=rule.supportsText||'';item.importLayer=rule.layerName??null;
            item.importedSheet=scan(rule.styleSheet,id);continue;
          }
          if(rule.type===1) {
            item.selector=rule.selectorText;item.css=rule.style.cssText;item.candidates=classify(rule.selectorText);
            if(rule.cssRules?.length) {item.nesting=true;walkRules(rule.cssRules,id);}
          } else if(rule.type===7) {item.css=rule.cssText;item.dependency=true;}
          else if(rule.cssRules) {
            item.header=rule.cssText.slice(0,rule.cssText.indexOf('{')).trim();
            if(rule.type===4) item.matchesNow=matchMedia(rule.conditionText).matches;
            walkRules(rule.cssRules,id);
          } else {item.css=rule.cssText;item.dependency=true;}
        }
      }
      try{walkRules(s.cssRules);}catch(e){sheets[sheetID].error=e.message;warnings.push(`CSS inaccessible : ${s.href||'inline'} : ${e.message}`);}
      stack.delete(s);return sheetID;
    }
    for(const s of [...document.styleSheets,...(document.adoptedStyleSheets||[])]) scan(s);
    return {label,time:new Date().toISOString(),url:location.href,baseURL:document.baseURI,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      environment:{userAgent:navigator.userAgent,language:navigator.language,fontsStatus:document.fonts?.status,
        dark:matchMedia('(prefers-color-scheme: dark)').matches,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches},
      analysisVersion:parsedProbes?'ast-superset-v1':'legacy',
      config:CONFIG,selection,targets,nodes,angularHosts,sheets,rules,warnings};
  }

  return observe(label);
}
