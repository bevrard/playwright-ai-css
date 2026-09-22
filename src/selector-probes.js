import parser from 'postcss-selector-parser';
import { collectInBrowser } from './collector.js';

const cache=new Map();
/** A superset probe: remove state/functional constraints, never rewrite source CSS. */
export function selectorProbes(selector) {
  if(cache.has(selector))return cache.get(selector);
  const result={};
  try {
    const root=parser().astSync(selector);
    for(const branch of root.nodes){
      const original=branch.toString().trim(),copy=branch.clone();
      let unsafe=false;
      copy.walk(n=>{if(n.type==='nesting'||n.namespace!==undefined||
        (n.type==='pseudo'&&['::part','::slotted','::shadow'].includes(n.value)))unsafe=true;});
      if(unsafe){result[original]=null;continue;}
      copy.walkPseudos(n=>n.remove());
      // Storybook/utility classes that simulate pseudo-states are broadened too.
      copy.walkClasses(n=>{if(/^:(hover|active|focus|focus-visible|focus-within|disabled|checked|visited)$/.test(n.value))n.remove();});
      copy.walkAttributes(n=>{if(['disabled','checked','selected','open','readonly','required','aria-expanded','aria-pressed','aria-selected','aria-checked','aria-disabled','aria-invalid','aria-busy'].includes(n.attribute))n.remove();});
      copy.walkComments(n=>n.remove());
      // Restore universal selectors where a removed pseudo was the whole compound.
      const nodes=[...copy.nodes];let compound=false;
      for(const node of nodes){
        if(node.type==='combinator'){
          if(!compound)copy.insertBefore(node,parser.universal({value:'*'}));
          compound=false;
        }else compound=true;
      }
      if(!compound)copy.append(parser.universal({value:'*'}));
      result[original]=copy.toString();
    }
  }catch {result[selector]=null;}
  cache.set(selector,result);return result;
}
export async function collectPage(page,{options={},label}={}) {
  const selectors=await page.evaluate(()=>{
    const values=new Set(),seen=new Set();
    function sheet(s){if(!s||seen.has(s))return;seen.add(s);try{rules(s.cssRules);}catch{}}
    function rules(list){for(const r of list){if(r.selectorText)values.add(r.selectorText);if(r.type===3)sheet(r.styleSheet);else if(r.cssRules&&r.type!==7)rules(r.cssRules);}}
    for(const s of [...document.styleSheets,...(document.adoptedStyleSheets||[])])sheet(s);
    return [...values];
  });
  const probes=Object.assign({},...selectors.map(selectorProbes));
  return page.evaluate(collectInBrowser,{options:{...options,selectorProbes:probes},label});
}
