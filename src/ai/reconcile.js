import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {occurrenceConditions} from '../local-css.js';

const declarations=css=>{
  const rule=postcss.parse(`source { ${css} }`).first;
  return rule.nodes.filter(node=>node.type==='decl');
};
const signature=nodes=>JSON.stringify(nodes.filter(node=>node.type==='decl').map(node=>[node.prop.toLowerCase(),node.value.trim(),!!node.important]));
const ruleSignature=definition=>signature(declarations(definition.css));
const insideConditions=rule=>{
  const result=[];for(let parent=rule.parent;parent?.type==='atrule';parent=parent.parent)result.unshift(`@${parent.name} ${parent.params}`.trim());
  return result;
};
const atRule=header=>{
  const match=/^@([\w-]+)(?:\s+([\s\S]*))?$/.exec(header);
  if(!match)throw new Error(`Condition CSS source non analysable : ${header}`);
  return postcss.atRule({name:match[1],params:match[2]||''});
};

function restoreConditions(rule,variants){
  if(!variants.length||variants.some(condition=>!condition.length))return false;
  const existing=insideConditions(rule);
  if(variants.some(condition=>JSON.stringify(condition)===JSON.stringify(existing)))return false;
  // Distinct source contexts must stay distinct. A single AI rule is cloned into
  // each observed context; it is never allowed to escape to the screen cascade.
  for(const condition of variants){
    let node=rule.clone();for(const header of [...condition].reverse()){const parent=atRule(header);parent.append(node);node=parent;}
    rule.before(node);
  }
  rule.remove();return true;
}

function observedPriorityLoss(archive,definition){
  const plainLengths=declarations(definition.css).filter(node=>/^[-+]?\d+(?:\.\d+)?px$/.test(node.value));
  if(!plainLengths.length)return [];
  const differences=[];
  for(const capture of archive.captures){
    for(const rule of capture.rules){
      if(archive.dictionary[rule.selectorRef]!==definition.selector||archive.dictionary[rule.cssRef]!==definition.css)continue;
      for(const candidate of rule.candidates||[]){
        if(candidate.reason!=='matches-current-context')continue;
        for(const id of candidate.nodes||[]){
          const node=capture.nodes.find(item=>item.id===id);
          if(node?.computedRef==null)continue;
          const computed=JSON.parse(archive.dictionary[node.computedRef]);
          for(const declaration of plainLengths){
            const actual=computed[declaration.prop];
            if(actual&&actual!==declaration.value)differences.push({property:declaration.prop,declared:declaration.value,observed:actual});
          }
        }
      }
    }
  }
  return [...new Map(differences.map(item=>[JSON.stringify(item),item])).values()];
}

// A global .theme .leaf selector is less specific than .theme fbr-button .btn.
// Angular adds scope attributes to both, erasing that difference. :where() on
// the leaf retains the condition while letting the observed component rule win.
function lowerGlobalClassPriority(rule,sourceSelector){
  const match=/^\.([\w-]+) \.([\w-]+)$/.exec(sourceSelector);
  if(!match)return false;
  const expected=`:host-context(.${match[1]}) :host .${match[2]}`;
  if(rule.selector.trim()!==expected)return false;
  rule.selector=`:host-context(.${match[1]}) :host :where(.${match[2]})`;
  return true;
}

function expectedSimpleHostSelector(source){
  try{return selectorParser().astSync(source).nodes.map(branch=>`:host ${branch.toString().trim()}`).join(', ');}
  catch{return null;}
}

export function reconcileAIResponses({input,archive,ambiguous,responses}){
  const roots=responses.map(response=>postcss.parse(response.css));
  const indexed=new Map();for(const root of roots)root.walkRules(rule=>{
    if(rule.parent?.name==='keyframes'||rule.parent?.name==='-webkit-keyframes')return;
    const key=signature(rule.nodes);if(!indexed.has(key))indexed.set(key,[]);indexed.get(key).push(rule);
  });
  const conditions=occurrenceConditions(input),report={restoredConditions:[],priorityAdjusted:[],unresolved:[]};
  for(const definition of ambiguous){
    const variants=[...(conditions.get(definition.id)?.values()||[])];
    const hasConditions=variants.length&&variants.every(condition=>condition.length);
    const simpleGlobal=/^\.[\w-]+ \.[\w-]+$/.test(definition.selector);
    const differences=hasConditions||!simpleGlobal?[]:observedPriorityLoss(archive,definition);
    if(!hasConditions&&!differences.length)continue;
    let matches=indexed.get(ruleSignature(definition))||[];
    if(matches.length>1){
      const expected=expectedSimpleHostSelector(definition.selector);
      matches=matches.filter(rule=>rule.selector.trim()===expected);
    }
    if(matches.length!==1){report.unresolved.push({id:definition.id,reason:`Rattachement non unique (${matches.length} règle(s) IA)`,conditions:variants,differences});continue;}
    const rule=matches[0];
    if(hasConditions){
      if(restoreConditions(rule,variants))report.restoredConditions.push({id:definition.id,conditions:variants});
    }
    if(differences.length){
      if(lowerGlobalClassPriority(rule,definition.selector))report.priorityAdjusted.push({id:definition.id,selector:definition.selector,differences});
      else report.unresolved.push({id:definition.id,reason:'Priorité source non restaurée automatiquement',differences});
    }
  }
  return {css:roots.map(root=>root.toString()).join('\n\n'),report};
}
