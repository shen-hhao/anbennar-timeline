// Portable, read-only packaging checks. This is not a historical-certainty audit.
import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here=path.dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2), rootIndex=argv.indexOf('--root');
const root=path.resolve(rootIndex>=0?argv[rootIndex+1]||'':path.join(here,'..'));
const dist=path.join(root,'dist'), failures=[], warnings=[];
async function walk(folder){
 const result=[];
 for(const entry of await readdir(folder,{withFileTypes:true})){
  const name=path.join(folder,entry.name);
  if(entry.isSymbolicLink()){failures.push({type:'symlink',file:path.relative(root,name)});continue;}
  if(entry.isDirectory())result.push(...await walk(name));else if(entry.isFile())result.push(name);
 }
 return result;
}
try{
 const files=await walk(dist), names=new Set(files.map(f=>path.relative(dist,f).split(path.sep).join('/')));
 for(const required of ['index.html','app.js','data/atlas.json','data/western-chronology.json','data/endpoint-1820.json'])
  if(!names.has(required))failures.push({type:'missing-entry',file:required});
 let bytes=0,jsonFiles=0,javascriptFiles=0,localPathFiles=0;
 for(const file of files){
  const name=path.relative(dist,file).split(path.sep).join('/'),info=await stat(file);bytes+=info.size;
  if(info.size>=100*1024*1024)failures.push({type:'git-file-size',file:name,bytes:info.size});
  if(!/\.(json|html|js|mjs|css|txt)$/i.test(name))continue;
  const text=await readFile(file,'utf8');
  if(/\.(?:js|mjs)$/.test(name)){
   javascriptFiles++;
   const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
   if(syntax.status!==0)failures.push({type:'invalid-javascript',file:name,detail:(syntax.stderr||syntax.error?.message||'Syntax check failed').trim()});
  }
  if(/\b[A-Za-z]:[\\/]|file:\/\/|localhost|127\.0\.0\.1/.test(text)){
   localPathFiles++;warnings.push({type:'local-reference-needs-review',file:name});
  }
  if(name.endsWith('.json')){jsonFiles++;try{JSON.parse(text);}catch{failures.push({type:'invalid-json',file:name});}}
  if(name.endsWith('.html')){
   for(const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)){
    const target=match[1];if(/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(target))continue;
    if(target.startsWith('/')){failures.push({type:'project-pages-root-path',file:name,target});continue;}
    let clean;try{clean=decodeURIComponent(target.split(/[?#]/)[0]);}catch{failures.push({type:'invalid-link',file:name});continue;}
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),clean));
    if(resolved.startsWith('../')){failures.push({type:'outside-published-root',file:name,target});continue;}
    if(clean.endsWith('/')||resolved==='.'){
     const index=path.posix.join(resolved,'index.html');
     if(!names.has(index))failures.push({type:'missing-local-link',file:name,target});
    }else if(clean&&!names.has(resolved))failures.push({type:'missing-local-link',file:name,target});
   }
  }
 }
 if(bytes>1024*1024*1024)failures.push({type:'pages-site-size',bytes});
 console.log(JSON.stringify({status:failures.length?'failed':warnings.length?'passed-with-review-warnings':'passed',root,files:files.length,bytes,jsonFiles,javascriptFiles,localPathFiles,failures,warnings,scope:'JavaScript syntax, JSON parsing, HTML local links, project-site paths and size only. No license/privacy clearance, dynamic JS fetch audit, full browser test, data consistency or historical approval.'},null,2));
 process.exitCode=failures.length?1:0;
}catch(error){console.error(JSON.stringify({status:'failed',message:error.message,scope:'Packaging input could not be read; an empty template is not a release.'}));process.exitCode=1;}
