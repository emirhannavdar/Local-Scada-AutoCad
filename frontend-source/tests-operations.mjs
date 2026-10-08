import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./src/operations-utils.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {segments,changedFields,toISO}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
test('history graph preserves zero and breaks at invalid quality and missing intervals',()=>{
 const row=(seconds,value=0,quality='GOOD')=>({timestamp:new Date(1700000000000+seconds*1000).toISOString(),value,quality});
 const result=segments([row(0),row(1,1),row(2,null,'BAD'),row(3,2),row(50,4),row(51,5)],1);
 assert.deepEqual(result.map(s=>s.map(r=>r.value)),[[0,1],[2],[4,5]]);
});
test('configuration diff detects nested edits, additions, removals without mutating snapshots',()=>{
 const before={ip:'a',map:{pin:4},removed:true},after={ip:'a',map:{pin:27},added:false};
 assert.deepEqual(changedFields(before,after),['added','map','removed']);assert.equal(before.map.pin,4);
 assert.deepEqual(changedFields(null,{id:1}),['id']);assert.throws(()=>toISO('invalid'));
});
