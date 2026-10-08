import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./src/collector-config.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {defaults,parsePins,validateDraft,importDraft,configFromDraft,saveDraft,loadDraft,DRAFT_KEY}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const base='http://192.168.1.38:8000/api/v1';
test('pin lists reject duplicates, non-numbers, out of range and conflicts',()=>{
 assert.deepEqual(parsePins('24, 0, 26'),[0,24,26]);
 for(const p of ['4,4','4,','-1','28','1.5',''])assert.throws(()=>parsePins(p));
 assert.throws(()=>parsePins('1',2));
 assert.throws(()=>validateDraft({...defaults(base),gpio:true,commands:true,inputs:true,pins:'4',inputPins:'4,24'}),/BCM 4/);
 assert.throws(()=>validateDraft({...defaults(base),timeout:NaN}));
});
test('config import preserves known fields and drops token from draft',()=>{
 const original=configFromDraft({...defaults(base),commands:true,gpio:true,inputs:true,autoTag:true,summary:45,ids:['45']},'secret');
 const d=importDraft(original,base);assert.deepEqual(configFromDraft(d,'secret'),original);
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 saveDraft(base,d);assert.ok(!store.get(DRAFT_KEY).includes('secret'));assert.ok(!store.get(DRAFT_KEY).includes('SCADA_API_TOKEN'));
 assert.deepEqual(loadDraft(base),d);assert.deepEqual(loadDraft('http://other/api/v1'),defaults('http://other/api/v1'));
 assert.throws(()=>importDraft({...original,UNKNOWN:'x'},base));
 assert.throws(()=>importDraft({...original,SCADA_ENABLE_GPIO:'true'},base));
 assert.throws(()=>importDraft({...original,SCADA_WORKER_ID:'two words'},base));
});
