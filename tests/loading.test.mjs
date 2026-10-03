import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readResponse,decodeJSON,loadAsset} from '../dist/data-loader.js';
import {createPublicDisplay} from '../dist/public-display.js';
import {assets} from '../dist/loading-assets.js';
const data=new URL('../dist/data/',import.meta.url);
const raw=async file=>JSON.parse(await readFile(new URL(file,data),'utf8'));
const derived=async file=>JSON.parse(gunzipSync(await readFile(new URL(file,data))));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('all 28 transport derivatives reproduce the complete original data, bound to input hashes',async()=>{
  const manifest=await raw('runtime/loading-assets.json');
  for(const [name,hash] of Object.entries(manifest.inputs)){
    const bytes=await readFile(new URL(name,data));assert.equal(sha(bytes),hash,name);
    const zip=await readFile(new URL(assets[name].file,data));assert.equal(sha(zip),assets[name].sha256,name);
    assert.deepEqual(JSON.parse(gunzipSync(zip)),JSON.parse(bytes),name);
  }
});

test('country directory and every on-demand country preserve all original records and source metadata',async()=>{
  const catalog=await raw('country-histories.json'),index=await derived(assets['dossier-index.json'].file);
  assert.deepEqual(index.sources,catalog.sources);
  assert.equal(index.countries.length,catalog.countries.length);
  for(let i=0;i<catalog.countries.length;i++){
    const entry=index.countries[i],country=catalog.countries[i];
    assert.equal(entry.tag,country.tag);assert.equal(entry.recordCount,(country.records||[]).length);
    assert.deepEqual(await derived(entry.asset.file),country,entry.tag);
    assert.deepEqual(await raw(entry.asset.plain),country,entry.tag+' plain fallback');
  }
});

test('map copy preserves public text, source unions, exact date exceptions and all map notice families',async()=>{
  const copy=await raw('public-copy.json'),compact=await derived(assets['map-copy.json'].file);
  const chronology=await raw('western-chronology.json'),catalog=await raw('country-histories.json');
  const before=createPublicDisplay({copy,steps:chronology.steps}),after=createPublicDisplay({copy:compact,steps:chronology.steps});
  for(const record of await raw('events.json'))assert.deepEqual(after.record(record,{surface:'events'}),before.record(record,{surface:'events'}),record.id);
  for(const record of chronology.steps)assert.deepEqual(after.record(record,{surface:'steps'}),before.record(record,{surface:'steps'}),record.id);
  for(const country of catalog.countries){
    assert.deepEqual(after.country(country),before.country(country),country.tag);
    for(const record of country.records||[])assert.deepEqual(after.record(record),before.record(record),record.id);
    if(country.reconstructionAssessment)assert.deepEqual(after.assessment(country.tag,'primary',country.reconstructionAssessment),before.assessment(country.tag,'primary',country.reconstructionAssessment));
    for(const [layer,a] of Object.entries(country.aliasReconstructionAssessments||{}))assert.deepEqual(after.assessment(country.tag,layer,a),before.assessment(country.tag,layer,a));
  }
  for(const [key,entry] of Object.entries(copy.noticesByKey)){
    if(!/^(western-chronology\.json:\/modelReviewNotes\/|haless-quality-endpoint-label:\/|relation-type-label:\/)/.test(key))continue;
    assert.ok(Object.hasOwn(compact.noticesByKey,key),key);
    const row=Number.isInteger(entry)?copy.noticeRows[entry]:entry;
    const original=Number.isInteger(row.originalText)?copy.textPool[row.originalText]:row.originalText;
    assert.deepEqual(after.notice(key,original),before.notice(key,original),key);
  }
});

test('gzip and server-decompressed JSON both decode without depending on response headers',async()=>{
  const value={name:'哈兰',year:1444,native:null};
  assert.deepEqual(await decodeJSON(gzipSync(JSON.stringify(value))),value);
  assert.deepEqual(await decodeJSON(Buffer.from(JSON.stringify(value))),value);
});

test('network failure retries the compressed request once',async()=>{
  let calls=0;
  const value=await loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{cache:false,fetchImpl:async()=>{if(++calls===1)throw new TypeError('offline');return new Response(gzipSync('{"ok":true}'));}});
  assert.deepEqual(value,{ok:true});assert.equal(calls,2);
});

test('missing gzip falls back to the original JSON and never fabricates empty data',async()=>{
  const urls=[];
  const value=await loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{cache:false,fetchImpl:async url=>{urls.push(url);return url.endsWith('.gz')?new Response('',{status:404}):new Response('{"year":1820}');}});
  assert.deepEqual(value,{year:1820});assert.deepEqual(urls.map(u=>u.split('/').at(-1)),['fixture.json.gz','fixture.json']);
});

test('older browsers request the plain fallback directly',async()=>{
  const original=globalThis.DecompressionStream;globalThis.DecompressionStream=undefined;
  try{let requested;assert.deepEqual(await loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{cache:false,fetchImpl:async url=>{requested=url;return new Response('{"ok":true}');}}),{ok:true});assert.ok(requested.endsWith('fixture.json'));}
  finally{globalThis.DecompressionStream=original;}
});

test('permanent HTTP failures remain visible and are not cached as success',async()=>{
  let calls=0;
  await assert.rejects(loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{cache:false,name:'地图',fetchImpl:async()=>{calls++;return new Response('',{status:403});}}),/地图.*HTTP 403/);
  assert.equal(calls,1);
});

test('a request with no response aborts at the inactivity deadline',async()=>{
  const fetchImpl=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))));
  await assert.rejects(readResponse('https://example.invalid/data',{fetchImpl,idleMs:15,timeoutMs:100}),{name:'AbortError'});
});

test('a stalled response body also aborts instead of leaving a permanent loading screen',async()=>{
  const fetchImpl=async(_url,{signal})=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));signal.addEventListener('abort',()=>controller.error(new DOMException('timeout','AbortError')));}}));
  await assert.rejects(readResponse('https://example.invalid/data',{fetchImpl,idleMs:15,timeoutMs:100}),{name:'AbortError'});
});

test('download progress counts actual body bytes',async()=>{
  const progress=[];
  const bytes=await readResponse('https://example.invalid/data',{fetchImpl:async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Length':'3'}}),onProgress:(n,total)=>progress.push([n,total])});
  assert.deepEqual([...bytes],[1,2,3]);assert.deepEqual(progress.at(-1),[3,3]);
});

test('blocked browser cache does not prevent loading',async()=>{
  const original=globalThis.caches;globalThis.caches={open:async()=>{throw Error('denied');}};
  try{assert.deepEqual(await loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{fetchImpl:async()=>new Response(gzipSync('{"ok":true}'))}),{ok:true});}
  finally{globalThis.caches=original;}
});

test('cached compressed data works with the network unavailable',async()=>{
  const original=globalThis.caches;globalThis.caches={open:async()=>({match:async()=>new Response(gzipSync('{"cached":true}'))})};
  try{assert.deepEqual(await loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{fetchImpl:async()=>{throw Error('offline');}}),{cached:true});}
  finally{globalThis.caches=original;}
});

test('corrupt local cache is discarded and repaired from the network',async()=>{
  const original=globalThis.caches;let deleted=false;
  globalThis.caches={open:async()=>({match:async()=>new Response('corrupt'),delete:async()=>{deleted=true;},put:async()=>{}})};
  try{assert.deepEqual(await loadAsset({file:'fixture.json.gz',plain:'fixture.json'},{fetchImpl:async()=>new Response(gzipSync('{"recovered":true}'))}),{recovered:true});assert.ok(deleted);}
  finally{globalThis.caches=original;}
});
