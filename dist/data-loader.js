import {assets,assetVersion} from './loading-assets.js';

export class DataLoadError extends Error {
  constructor(file,message,options={}) {super(`${file}：${message}`,options);this.name='DataLoadError';this.file=file;}
}
const pending=new Map();
const base=new URL('./data/',import.meta.url);
const cacheName=`halann-data-${assetVersion}`;

// Each response has both a total deadline and an inactivity deadline, including
// its body. A fulfilled fetch() alone does not mean the download has finished.
export async function readResponse(url,{fetchImpl=globalThis.fetch,onProgress=()=>{},timeoutMs=90000,idleMs=20000}={}){
  const controller=new AbortController();
  let idleTimer;
  const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(),idleMs);};
  const deadline=setTimeout(()=>controller.abort(),timeoutMs);
  resetIdle();
  try{
    const response=await fetchImpl(url,{signal:controller.signal});
    if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
    resetIdle();
    const total=Number(response.headers.get('Content-Length'))||0;
    const reader=response.body?.getReader();
    if(!reader){const bytes=new Uint8Array(await response.arrayBuffer());onProgress(bytes.length,total);return bytes;}
    const chunks=[];let length=0;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      resetIdle();chunks.push(value);length+=value.length;onProgress(length,total);
    }
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  } finally {clearTimeout(deadline);clearTimeout(idleTimer);}
}
export async function decodeJSON(bytes,{Decompress=globalThis.DecompressionStream}={}){
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    if(!Decompress)throw new Error('浏览器不支持压缩数据');
    return new Response(new Blob([bytes]).stream().pipeThrough(new Decompress('gzip'))).json();
  }
  // A server may transparently decompress a .gz resource via Content-Encoding.
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function openCache(){
  try{return await globalThis.caches?.open(cacheName);}catch{return null;}
}
export async function loadAsset(asset,{name=asset.plain,onProgress=()=>{},fetchImpl=globalThis.fetch,cache=true,timeoutMs,idleMs}={}){
  const compressed=typeof globalThis.DecompressionStream==='function';
  const url=new URL(compressed?asset.file:asset.plain,base).href;
  const store=cache&&compressed?await openCache():null;
  // Content-addressed URLs bind a cached response to this exact data revision.
  try{
    const hit=await store?.match(url);
    if(hit){const bytes=new Uint8Array(await hit.arrayBuffer());const value=await decodeJSON(bytes);onProgress(bytes.length,bytes.length);return value;}
  }catch{try{await store?.delete(url);}catch{/* Private browsing/quota errors are non-fatal. */}}
  let last;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const bytes=await readResponse(url,{fetchImpl,timeoutMs,idleMs,onProgress:(n,total)=>onProgress(n,total||asset.bytes)});
      const value=await decodeJSON(bytes);
      // Cache writes must not delay rendering or turn a successful load into a failure.
      if(store)void store.put(url,new Response(bytes)).catch(()=>{});
      return value;
    }catch(error){
      last=error;
      if(error.status===404&&compressed){
        const bytes=await readResponse(new URL(asset.plain,base).href,{fetchImpl,timeoutMs,idleMs,onProgress});
        return decodeJSON(bytes);
      }
      if(error.status&&error.status<500)break;
    }
  }
  throw new DataLoadError(name,last?.name==='AbortError'?'连接超时，请重试或更换网络':last?.message||'网络连接失败',{cause:last});
}
export function loadData(file,options={}){
  if(!pending.has(file)){
    const asset=assets[file]||{file,plain:file};
    pending.set(file,loadAsset(asset,{...options,name:file}).catch(error=>{pending.delete(file);throw error;}));
  }
  return pending.get(file);
}
export function dataAsset(file){return assets[file];}
