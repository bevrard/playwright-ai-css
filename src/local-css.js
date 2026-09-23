import parser from 'postcss-selector-parser';
import postcss from 'postcss';

const angularAttribute=node=>node.type==='attribute'&&/^_ng(?:host|content)-/.test(node.attribute||'');
const insidePredicate=node=>{for(let p=node.parent;p;p=p.parent)if(p.type==='pseudo'&&[':has',':not'].includes(p.value))return true;return false;};
const cleanNodes=nodes=>nodes.filter(node=>!angularAttribute(node)).map(node=>node.clone());
const stringify=nodes=>{const selector=parser.selector();for(const node of nodes)selector.append(node);return selector.toString().trim();};

export function convertSelector(selector,component,{hostAttributes=new Set(),contentAttributes=new Set()}={}){
  try{
    const root=parser().astSync(selector),converted=[];let nonMatching=false;
    for(const branch of root.nodes){
      if(branch.some(node=>node.type==='nesting'))return {safe:false,reason:'sélecteur imbriqué'};
      let emptyAlternative=false;
      branch.walkPseudos(pseudo=>{
        if([':is',':where'].includes(pseudo.value)&&pseudo.nodes?.every(option=>!option.nodes.length))emptyAlternative=true;
      });
      if(emptyAlternative){converted.push(':host:not(*)');nonMatching=true;continue;}
      const nodes=[...branch.nodes];
      let anchor=nodes.findIndex(node=>(node.type==='tag'&&node.value.toLowerCase()===component&&!insidePredicate(node))||
        (node.type==='attribute'&&hostAttributes.has(node.attribute)&&!insidePredicate(node)));
      if(anchor>=0){
        let start=anchor,end=anchor;
        while(start>0&&nodes[start-1].type!=='combinator')start--;
        while(end+1<nodes.length&&nodes[end+1].type!=='combinator')end++;
        const qualifiers=cleanNodes(nodes.slice(start,end+1).filter(node=>!(node.type==='tag'&&node.value.toLowerCase()===component)&&
          !(node.type==='attribute'&&hostAttributes.has(node.attribute))));
        const external=cleanNodes(nodes.slice(0,start));
        while(external.at(-1)?.type==='combinator')external.pop();
        const tail=cleanNodes(nodes.slice(end+1));
        const host=qualifiers.length?`:host(${stringify(qualifiers)})`:':host';
        const context=external.length?`:host-context(${stringify(external)}) `:'';
        const tailText=tail.length?stringify(tail):'';
        const descendantSpace=tail[0]?.type==='combinator'&&!tail[0].value.trim()?' ':'';
        converted.push(`${context}${host}${descendantSpace}${tailText}`);
        continue;
      }
      const scoped=nodes.some(node=>node.type==='attribute'&&contentAttributes.has(node.attribute)&&!insidePredicate(node));
      if(scoped){
        const cleaned=stringify(cleanNodes(nodes));
        converted.push(`:host ${cleaned}`);
        continue;
      }
      return {safe:false,reason:'ancre de composant non démontrée'};
    }
    return {safe:true,selector:converted.join(', '),...(nonMatching?{nonMatching:true}:{})};
  }catch(error){return {safe:false,reason:`sélecteur non analysable : ${error.message}`};}
}

function angularEvidence(input){
  const hostAttributes=new Set(),contentAttributes=new Set();
  for(const capture of input.captures){
    const nodes=new Map(capture.nodes.map(node=>[node[0],node]));
    const queue=capture.targets.map(target=>target.node),owned=new Set(queue);
    while(queue.length){const node=nodes.get(queue.shift());for(const child of node?.[4]||[])if(!owned.has(child)){owned.add(child);queue.push(child);}}
    for(const id of owned){
      const attrs=input.attributes[nodes.get(id)?.[2]]||{};
      for(const name of Object.keys(attrs)){
        if(name.startsWith('_nghost-')&&capture.targets.some(target=>target.node===id))hostAttributes.add(name);
        if(name.startsWith('_ngcontent-'))contentAttributes.add(name);
      }
    }
  }
  return {hostAttributes,contentAttributes};
}

export function occurrenceConditions(input){
  const result=new Map(),definitions=new Map(input.definitions.map(definition=>[definition.id,definition]));
  for(const capture of input.captures){
    const rows=new Map(capture.rules.map(row=>[row[0],row]));
    const sheets=new Map(capture.sheets.map(sheet=>[sheet.id,sheet]));
    for(const row of capture.rules){
      const definition=definitions.get(row[1]);if(definition?.role!=='required'||definition.kind!=='CSSStyleRule')continue;
      const conditions=[];let parent=row[3];
      while(parent!=null){const parentRow=rows.get(parent),parentDefinition=definitions.get(parentRow?.[1]);if(parentDefinition?.header)conditions.unshift(parentDefinition.header);parent=parentRow?.[3]??null;}
      const sheetMedia=sheets.get(row[2])?.media;if(sheetMedia&&sheetMedia.toLowerCase()!=='all')conditions.unshift(`@media ${sheetMedia}`);
      const key=JSON.stringify(conditions);if(!result.has(definition.id))result.set(definition.id,new Map());result.get(definition.id).set(key,conditions);
    }
  }
  return result;
}

const wrap=(css,conditions)=>conditions.reduceRight((body,header)=>`${header} {\n${body.split('\n').map(line=>'  '+line).join('\n')}\n}`,css);

export function prepareLocalCSS(input){
  const evidence=angularEvidence(input),conditions=occurrenceConditions(input),safe=[],ambiguous=[];
  for(const definition of input.definitions.filter(item=>item.role==='required'&&item.kind==='CSSStyleRule')){
    const converted=convertSelector(definition.selector,input.component,evidence);
    if(!converted.safe){ambiguous.push({...definition,reason:converted.reason});continue;}
    const rule=`${converted.selector} { ${definition.css} }`;
    const variants=conditions.get(definition.id)||new Map([["[]",[]]]);
    safe.push({id:definition.id,selector:converted.selector,css:[...new Set([...variants.values()].map(condition=>wrap(rule,condition)))].join('\n'),...(converted.nonMatching?{nonMatching:true}:{})});
  }
  const uniqueCSS=new Map();
  for(const item of safe){if(!uniqueCSS.has(item.css))uniqueCSS.set(item.css,[]);uniqueCSS.get(item.css).push(item.id);}
  return {component:input.component,safe,ambiguous,
    css:[...uniqueCSS].map(([css,ids])=>`/* ${ids.join(', ')} */\n${css}`).join('\n\n')+'\n',
    report:{required:input.completeness.requiredDefinitionIDs.length,safe:safe.length,ambiguous:ambiguous.length,
      safeIDs:safe.map(item=>item.id),ambiguousIDs:ambiguous.map(item=>item.id),
      nonMatchingSourceIDs:safe.filter(item=>item.nonMatching).map(item=>item.id)}};
}
