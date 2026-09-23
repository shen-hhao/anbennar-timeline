// Local staging only: this command never commits, pushes, or configures GitHub.
import {readdir, readFile, mkdir, copyFile, writeFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'dist');
const output=path.resolve(process.argv[2] || path.join(root,'.pages-stage'));
const inside=path.relative(source,output);
if(!inside || (!inside.startsWith('..'+path.sep) && inside!=='..' && !path.isAbsolute(inside)))
  throw new Error('The staging directory must be outside dist.');
try {await lstat(output);throw new Error('Staging directory already exists; choose a new empty path.');}
catch(error){if(error.code!=='ENOENT')throw error;}
const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true});
if(status.status!==0 || status.stdout.trim())throw new Error('Commit the reviewed source first; staging requires a clean Git checkout.');
const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
if(revision.status!==0)throw new Error('Cannot identify the source commit.');
const committed=spawnSync('git',['ls-tree','-r','-z','HEAD','--','dist'],{cwd:root,encoding:'utf8',windowsHide:true});
if(committed.status!==0)throw new Error('Cannot read the committed website tree.');
const blobs=new Map(committed.stdout.split('\0').filter(Boolean).map(row=>{
  const [metadata,name]=row.split('\t');const [mode,type,oid]=metadata.split(' ');
  if(type!=='blob'||mode==='120000')throw new Error('Only committed regular files may be published.');
  return [name,oid];
}));
const files=[];
async function collect(folder){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);
    if(entry.isSymbolicLink())throw new Error('Symbolic links are not allowed in the Pages source.');
    if(entry.isDirectory())await collect(file);else if(entry.isFile())files.push(file);
  }
}
await collect(source);
if(!files.includes(path.join(source,'index.html')))throw new Error('dist/index.html is missing.');
const manifest=[];
for(const file of files){
  const relative=path.relative(source,file).split(path.sep).join('/');
  if(relative==='publication.json')throw new Error('publication.json is reserved for staging metadata.');
  const bytes=await readFile(file);
  const trackedPath='dist/'+relative,oid=blobs.get(trackedPath);
  if(!oid)throw new Error('Untracked or ignored file in dist: '+relative);
  const blobHash=createHash(oid.length===64?'sha256':'sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(blobHash!==oid)throw new Error('File does not match the reviewed commit: '+relative);
  manifest.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await mkdir(output);
for(const file of files){
  const target=path.join(output,path.relative(source,file));
  await mkdir(path.dirname(target),{recursive:true});
  await copyFile(file,target);
}
await writeFile(path.join(output,'.nojekyll'),'');
for(const item of manifest){
  const actual=createHash('sha256').update(await readFile(path.join(output,item.path))).digest('hex');
  if(actual!==item.sha256)throw new Error('A staged file differs from the source manifest: '+item.path);
}
const finalStatus=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true});
const finalRevision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
if(finalStatus.status!==0||finalStatus.stdout.trim()||finalRevision.stdout.trim()!==revision.stdout.trim())
  throw new Error('The reviewed checkout changed while staging; do not publish this directory.');
await writeFile(path.join(output,'publication.json'),JSON.stringify({
  sourceCommit:revision.stdout.trim(),
  repository:'https://github.com/shen-hhao/anbennar-timeline',
  releaseId:JSON.parse(await readFile(path.join(source,'release.json'),'utf8')).releaseId,
  files:manifest.sort((a,b)=>a.path.localeCompare(b.path)),
  deployment:'Manual gh-pages branch publication; preparing this directory does not publish it.'
},null,2)+'\n');
console.log(JSON.stringify({status:'staged-locally',output,files:files.length,sourceCommit:revision.stdout.trim(),published:false},null,2));
