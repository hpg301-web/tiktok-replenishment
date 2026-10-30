import { readFile, writeFile, rm, open, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { backupSoftware, applySoftware, rollbackSoftware, DATA_FILES } from './update-files.mjs';
import { sha256 } from './update-archive.mjs';
const DATA=DATA_FILES;
export async function verifyStage(job){
  const release=JSON.parse(await readFile(join(job.stage,'release.json'),'utf8'));
  if(release.version!==job.version||release.buildId!==job.buildId||sha256(Buffer.from(JSON.stringify(release.files)))!==job.buildId||job.paths.length!==release.files.length+1)throw Error('Staged release identity changed');
  const seen=new Set();
  for(const f of release.files){if(seen.has(f.path)||!job.paths.includes(f.path)||sha256(await readFile(join(job.stage,f.path)))!==f.sha256)throw Error('Staged file changed');seen.add(f.path);}
}
async function waitForExit(pid){
  for(let i=0;i<150;i++){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}await delay(200);}throw Error('原服务未能停止，未替换程序文件');
}
async function startServer(job,buildId){
  const log=await open(join(job.dataDir,'server.log'),'a'),err=await open(join(job.dataDir,'error.log'),'a');let child;
  try{
    child=spawn(process.execPath,[join(job.root,'scripts/serve.mjs')],{cwd:job.root,env:{...process.env,STOCKPILOT_PORT:String(job.port)},detached:true,windowsHide:true,stdio:['ignore',log.fd,err.fd]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  }finally{await log.close();await err.close();}
  try{
    for(let i=0;i<120;i++){
      if(child.exitCode!==null)throw Error('新服务启动后退出');
      try{
        const base='http://127.0.0.1:'+job.port;
        const health=await (await fetch(base+'/_stockpilot/health',{signal:AbortSignal.timeout(1000)})).json();
        const mode=await (await fetch(base+'/api/mode',{signal:AbortSignal.timeout(1000)})).json();
        if(health.pid===child.pid&&(!buildId||mode.buildId===buildId)){
          const code=(await readFile(join(job.dataDir,'access-code.txt'),'utf8')).trim();
          const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({code}),signal:AbortSignal.timeout(5000)});
          if(!login.ok)throw Error('新服务登录验证失败');
          const cookie=login.headers.get('set-cookie').split(';')[0];
          for(const market of ['US','DE']){const r=await fetch(base+'/api/workspace/'+market,{headers:{Cookie:cookie},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('新版本无法读取现有团队数据');await r.arrayBuffer();}
          await writeFile(join(job.dataDir,'process.json'),JSON.stringify({pid:child.pid,instance:health.instance}));
          return child;
        }
      }catch(e){if(e.message.startsWith('新'))throw e;}
      await delay(250);
    }
    throw Error('新服务就绪验证超时');
  }catch(e){child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,5000);});throw e;}
}
async function restoreData(job){
  for(const name of DATA)try{await copyFile(join(job.jobDir,'data-backup',name),join(job.dataDir,name));}catch(e){if(e.code==='ENOENT')await rm(join(job.dataDir,name),{force:true});else throw e;}
}
async function unchangedData(job){
  for(const name of DATA){let before=null,after=null;try{before=await readFile(join(job.jobDir,'data-backup',name));}catch(e){if(e.code!=='ENOENT')throw e;}try{after=await readFile(join(job.dataDir,name));}catch(e){if(e.code!=='ENOENT')throw e;}if((before===null)!==(after===null)||before&&sha256(before)!==sha256(after))throw Error('新版本改变了团队数据，已阻止完成更新');}
}
export async function runUpdate(job,{wait=waitForExit,start=startServer}={}){
  const status=async(phase,message)=>writeFile(join(job.dataDir,'update-status.json'),JSON.stringify({phase,message,version:job.version,updatedAt:new Date().toISOString()}));
  const backup=join(job.jobDir,'software-backup');let record,stopped=false,newChild;
  try{
    await wait(job.oldPid);stopped=true;await verifyStage(job);
    record=await backupSoftware(job.root,job.stage,backup,job.paths);
    await applySoftware(job.root,job.stage,record);
    newChild=await start(job,job.buildId);await unchangedData(job);
    await status('succeeded','更新完成；团队数据和访问口令已保留，请重新登录。');
    await rm(join(job.dataDir,'update-lock'),{force:true});
  }catch(e){
    if(!stopped){await status('needs-attention','原服务未能停止，程序未替换。请保留备份并联系管理员。');return;}
    if(newChild){newChild.kill();await delay(500);}
    try{
      if(record)await rollbackSoftware(job.root,backup,record);
      await restoreData(job);
      await start(job,null);
      await status('rolled-back','新版未通过验证，已恢复旧版与原数据。原因：'+e.message);
      await rm(join(job.dataDir,'update-lock'),{force:true});
    }catch(rollbackError){await status('needs-attention','自动恢复未完成，请保留 .stockpilot/updates 内备份并联系管理员。'+rollbackError.message);throw rollbackError;}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const job=JSON.parse(await readFile(process.argv[2],'utf8'));
  await runUpdate(job);
}
