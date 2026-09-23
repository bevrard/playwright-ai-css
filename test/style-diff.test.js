import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareArchives} from '../src/style-diff.js';

const archive=color=>({dictionary:[JSON.stringify({color,display:'block'})],captures:[{
 label:'page / normal',viewport:{width:1280,height:720},nodes:[{id:0,path:'html > body:nth-child(2) > fbr-button:nth-child(1)',tag:'fbr-button',computedRef:0}]
}]});

test('computed-style comparison is deterministic and reports exact property changes',()=>{
 const equal=compareArchives(archive('red'),archive('red'),{properties:['color','display']});
 assert.equal(equal.status,'equal');assert.equal(equal.comparedProperties,2);
 const changed=compareArchives(archive('red'),archive('blue'),{properties:['color','display']});
 assert.equal(changed.status,'different');assert.deepEqual(changed.differences,[{
  capture:'page / normal|1280x720',path:'html > body:nth-child(2) > fbr-button:nth-child(1)',tag:'fbr-button',property:'color',before:'red',after:'blue'
 }]);
});
