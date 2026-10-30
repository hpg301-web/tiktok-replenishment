import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
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
  return {accessCode,read,async pause(){paused=true;await queue;},resume(){paused=false;},save(market,body,revision){
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
