import { mkdir, readFile, writeFile, rename, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validate, plan } from '../src/engine.js';
export async function openStore(dir) {
  await mkdir(join(dir,'backups'),{recursive:true});
  const codeFile=join(dir,'access-code.txt');
  try { await writeFile(codeFile,randomBytes(18).toString('base64url'),{flag:'wx',mode:0o600}); } catch(e) { if(e.code!=='EEXIST')throw e; }
  const accessCode=(await readFile(codeFile,'utf8')).trim();
  if(accessCode.length<12)throw Error('Access code must contain at least 12 characters');
  let queue=Promise.resolve(),paused=false;
  const read=async market=>{
    try {
      const saved=JSON.parse(await readFile(join(dir,market+'.json'),'utf8'));
      if(!Number.isSafeInteger(saved.revision)||saved.revision<1)throw Error('Invalid workspace revision');
      validate(saved.data,market);plan(saved.data,market);return saved;
    }catch(e){
      if(e.code!=='ENOENT')throw e;
      const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      return {revision:0,data:{asOf,sales:[],inventory:[],pipeline:[],overrides:{},routes:{},productSignals:{}},isDemo:false};
    }
  };
  return {accessCode,read,async pause(){paused=true;await queue;},resume(){paused=false;},clearUS(input,revision,hooks){
    if(input?.confirmed!==true)throw Object.assign(Error('请先点击确认清除，美国工作区尚未更改'),{status:400});
    if(paused)throw Object.assign(Error('主机正在更新，暂时不能清除记录'),{status:503});
    const operation=queue.then(async()=>{
      const previous=await read('US');
      if(revision!==previous.revision)throw Object.assign(Error('同事已更新美国数据，请刷新后重新确认；本次未清除'),{status:409});
      const file=join(dir,'US.json'),id=Date.now()+'.'+randomBytes(8).toString('hex'),backup=join(dir,'backups','US.before-clear.'+id+'.json');
      const next={revision:previous.revision+1,isDemo:false,updatedAt:new Date().toISOString(),data:{asOf:previous.data.asOf,sales:[],inventory:[],pipeline:[],routes:{},overrides:{},productSignals:{},skuMappings:{}}};
      let written=false;
      await hooks.pause();
      try{
        if(previous.revision)await copyFile(file,backup);
        const temp=file+'.clear.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,file);written=true;
        await hooks.resetWorkspace();
        return next;
      }catch(error){
        if(written){
          try{if(previous.revision){const restore=file+'.restore.tmp';await copyFile(backup,restore);await rename(restore,file);}else await rm(file,{force:true});}
          catch{throw Object.assign(Error('清除未完成且自动恢复失败，请保留主机backups备份并联系管理员'),{status:503});}
        }
        throw Object.assign(Error('清除未完成，原美国工作区已保留：'+error.message),{status:503});
      }finally{hooks.resume();}
    });
    queue=operation.catch(()=>{});return operation;
  },save(market,body,revision){
    if(paused)throw Object.assign(Error('主机正在更新，暂时不能修改数据；请稍后刷新'),{status:503});
    const operation=queue.then(async()=>{
      validate(body.data,market);plan(body.data,market);
      const previous=await read(market);
      if(previous.revision!==revision){const e=Error('同事已更新数据；请先重新载入最新版本，再重新操作。本次修改未保存。');e.status=409;throw e;}
      const next={revision:previous.revision+1,data:body.data,isDemo:body.isDemo===true,updatedAt:new Date().toISOString()};
      const file=join(dir,market+'.json'),tmp=join(dir,market+'.'+randomBytes(8).toString('hex')+'.tmp');
      if(previous.revision)await copyFile(file,join(dir,'backups',market+'.'+previous.revision+'.'+Date.now()+'.json'));
      await writeFile(tmp,JSON.stringify(next),{mode:0o600});
      await rename(tmp,file);
      return next;
    });
    queue=operation.catch(()=>{});return operation;
  }};
}
