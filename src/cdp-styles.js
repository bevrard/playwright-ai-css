const usefulComputed=new Set([
  'display','position','box-sizing','width','height','min-width','min-height','max-width','max-height',
  'margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left',
  'border-top-width','border-right-width','border-bottom-width','border-left-width','border-radius',
  'color','background-color','background-image','box-shadow','opacity','visibility','overflow','overflow-x','overflow-y',
  'font-family','font-size','font-style','font-weight','line-height','letter-spacing','text-align','text-decoration-line',
  'white-space','transform','flex','flex-direction','align-items','justify-content','gap','grid-template-columns','z-index'
]);

const declarations=style=>(style?.cssProperties||[])
  .filter(property=>property.name&&!property.disabled&&property.parsedOk!==false)
  .map(property=>({name:property.name,value:property.value,important:!!property.important,implicit:!!property.implicit}));

const ruleSummary=match=>({
  selector:match.rule?.selectorList?.text||'',
  matchingSelectors:match.matchingSelectors||[],
  origin:match.rule?.origin||null,
  styleSheetId:match.rule?.styleSheetId||null,
  declarations:declarations(match.rule?.style)
});

/** Chromium-only evidence equivalent to the Matched CSS Rules pane. */
export async function collectMatchedStyles(page,snapshot){
  const session=await page.context().newCDPSession(page);
  try{
    await session.send('DOM.enable');await session.send('CSS.enable');
    const {root}=await session.send('DOM.getDocument',{depth:0,pierce:false});
    const records=[],rules=[],ruleIDs=new Map();
    const internRule=match=>{
      const rule=ruleSummary(match),key=JSON.stringify(rule);
      if(!ruleIDs.has(key)){ruleIDs.set(key,rules.length);rules.push(rule);}
      return ruleIDs.get(key);
    };
    for(const node of snapshot.nodes.filter(node=>node.computed&&node.path)){
      const found=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:node.path});
      if(!found.nodeId)continue;
      const [matched,computed]=await Promise.all([
        session.send('CSS.getMatchedStylesForNode',{nodeId:found.nodeId}),
        session.send('CSS.getComputedStyleForNode',{nodeId:found.nodeId})
      ]);
      records.push({node:node.id,path:node.path,
        inline:declarations(matched.inlineStyle),attributes:(matched.attributesStyle||[]).flatMap(declarations),
        matched:(matched.matchedCSSRules||[]).map(internRule),
        inherited:(matched.inherited||[]).map(entry=>({inline:declarations(entry.inlineStyle),matched:(entry.matchedCSSRules||[]).map(internRule)})),
        computed:Object.fromEntries((computed.computedStyle||[]).filter(p=>usefulComputed.has(p.name)).map(p=>[p.name,p.value]))});
    }
    return {protocol:'Chrome DevTools Protocol',rules,records};
  }finally{await session.detach().catch(()=>{});}
}
