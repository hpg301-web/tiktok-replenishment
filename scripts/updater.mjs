import * as http from 'node:http';
import { mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyArchive } from './update-archive.mjs';
import { stageFiles, snapshotData } from './update-files.mjs';
export const SOURCE='https://raw.githubusercontent.com/hpg301-web/tiktok-replenishment/main/downloads/';
let proxyReady=false;
export async function fetchOfficial(file,max){
  if(!['update.json','StockPilot-Windows.zip'].includes(file))throw Error('Unsupported download');
  if(!proxyReady){if(http.setGlobalProxyFromEnv)http.setGlobalProxyFromEnv();proxyReady=true;}
  const response=await fetch(SOURCE+file,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
  if(!response.ok)throw Error('无法连接官方更新源（HTTP '+response.status+'），原版本未更改');
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('更新响应超出大小限制');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export function validManifest(value){
  if(value?.schema!==1||!/^\d+\.\d+\.\d+$/.test(value.version)||!/^[a-f0-9]{64}$/.test(value.buildId)||!/^[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>20*1024*1024)throw Error('官方更新信息无效');
  return value;
}
function older(a,b){const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]<bb[i];}return false;}
export async function currentRelease(root){try{return JSON.parse(await readFile(join(root,'release.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,buildId:null};}}
export function createUpdater({root,dataDir,store,shutdown,download=fetchOfficial,launch=launchWorker,platform=process.platform,port=5173,current}){
  let checked=null,active=false;
  const supported=platform==='win32'&&!!current.buildId&&!existsSync(join(root,'.git'));
  const statusPath=join(dataDir,'update-status.json');
  const status=async()=>{try{return JSON.parse(await readFile(statusPath,'utf8'));}catch(e){if(e.code==='ENOENT')return {phase:'idle'};throw e;}};
  const save=async value=>{await mkdir(dataDir,{recursive:true});await writeFile(statusPath,JSON.stringify({...value,updatedAt:new Date().toISOString()}));};
  return {supported,current,status,
    async check(){
      if(active)return {...await status(),updating:true};
      try{const remote=validManifest(JSON.parse((await download('update.json',65536)).toString()));
        const available=!older(remote.version,current.version)&&remote.buildId!==current.buildId;
        checked={...remote,available};return {available,supported,currentVersion:current.version,currentBuild:current.buildId,version:remote.version,buildId:remote.buildId,notes:String(remote.notes||'功能与稳定性更新').slice(0,2000)};
      }catch{throw Object.assign(Error('暂时无法检查官方更新。请确认主机能连接 GitHub；现有版本和数据未更改。'),{status:502});}
    },
    async install(input){
      if(!supported)throw Object.assign(Error('请在 Windows 部署版主机使用在线更新'),{status:400});
      if(active||existsSync(join(dataDir,'update-lock')))throw Object.assign(Error('已有更新正在进行，请勿重复操作'),{status:409});
      if(!checked?.available||input?.confirmed!==true||input.buildId!==checked.buildId)throw Object.assign(Error('请先检查更新并确认所选版本'),{status:409});
      active=true;let locked=false;
      try{
        const remote=checked;await save({phase:'downloading',version:remote.version});
        const bytes=await download('StockPilot-Windows.zip',20*1024*1024);const verified=verifyArchive(bytes,remote);
        const id=Date.now()+'-'+randomUUID(),jobDir=join(dataDir,'updates',id),stage=join(jobDir,'stage');
        await stageFiles(stage,verified.files);
        await store.pause();
        await writeFile(join(dataDir,'update-lock'),id,{flag:'wx'});locked=true;
        await save({phase:'backing-up',version:remote.version});
        await snapshotData(dataDir,join(jobDir,'data-backup'));
        const job={root:resolve(root),dataDir:resolve(dataDir),jobDir:resolve(jobDir),stage:resolve(stage),paths:[...verified.files.keys()],oldPid:process.pid,port,version:remote.version,buildId:remote.buildId};
        const jobFile=join(jobDir,'job.json');await writeFile(jobFile,JSON.stringify(job));
        await launch(jobFile,root,dataDir);
        await save({phase:'restarting',version:remote.version});
        setTimeout(shutdown,300);
        return {accepted:true,version:remote.version};
      }catch(e){if(locked)await rm(join(dataDir,'update-lock'),{force:true});store.resume();active=false;await save({phase:'failed',message:'更新准备失败，原版继续运行，团队数据未覆盖。'});throw Object.assign(Error('更新未安装：'+e.message),{status:502});}
    }
  };
}
async function launchWorker(jobFile,root,dataDir){
  const log=await open(join(dataDir,'update-worker.log'),'a');
  try{const child=spawn(process.execPath,[join(root,'scripts/apply-update.mjs'),jobFile],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();}finally{await log.close();}
}
