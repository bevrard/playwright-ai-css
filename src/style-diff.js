export const comparisonProperties=[
  'display','position','box-sizing','width','height','min-width','min-height','max-width','max-height',
  'margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left',
  'border-top-width','border-right-width','border-bottom-width','border-left-width','border-radius',
  'color','background-color','background-image','box-shadow','opacity','visibility','overflow','overflow-x','overflow-y',
  'font-family','font-size','font-style','font-weight','line-height','letter-spacing','text-align','text-decoration-line',
  'white-space','transform','flex','flex-direction','align-items','justify-content','gap','grid-template-columns','z-index'
];

const decode=(archive,ref)=>ref===undefined?{}:JSON.parse(archive.dictionary[ref]);
const captureKey=capture=>`${capture.label}|${capture.viewport?.width}x${capture.viewport?.height}`;

export function compareArchives(before,after,{properties=comparisonProperties}={}){
  const afterCaptures=new Map(after.captures.map(capture=>[captureKey(capture),capture])),differences=[],missing=[];
  let comparedNodes=0,comparedProperties=0;
  for(const leftCapture of before.captures){
    const key=captureKey(leftCapture),rightCapture=afterCaptures.get(key);
    if(!rightCapture){missing.push({capture:key,side:'after'});continue;}
    const rightNodes=new Map(rightCapture.nodes.map(node=>[node.path,node]));
    for(const leftNode of leftCapture.nodes.filter(node=>node.computedRef!==undefined)){
      if(!leftNode.path){missing.push({capture:key,node:leftNode.id,side:'before',reason:'chemin DOM absent ; refaire la collecte'});continue;}
      const rightNode=rightNodes.get(leftNode.path);
      if(!rightNode||rightNode.computedRef===undefined){missing.push({capture:key,path:leftNode.path,side:'after'});continue;}
      comparedNodes++;const left=decode(before,leftNode.computedRef),right=decode(after,rightNode.computedRef);
      for(const property of properties){
        comparedProperties++;
        if((left[property]??'')!==(right[property]??''))differences.push({capture:key,path:leftNode.path,tag:leftNode.tag,property,before:left[property]??'',after:right[property]??''});
      }
    }
  }
  return {status:!comparedNodes?'insufficient':missing.length||differences.length?'different':'equal',comparedNodes,comparedProperties,differenceCount:differences.length,missing,differences};
}
