import { lstat, mkdir, copyFile, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { allowedFile } from './update-archive.mjs';
export async function safeTarget(root,path){
  if(!allowedFile(path))throw Error('Refusing path outside software scope');
  let current=root;
  for(const part of path.split('/')){
    current=join(current,part);
    try{if((await lstat(current)).isSymbolicLink())throw Error('Refusing symbolic link in installation');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return current;
}
export async function stageFiles(stage,files){
  await mkdir(stage,{recursive:true});
  for(const [path,data] of files){const dest=await safeTarget(stage,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,data);}
}
export async function backupSoftware(root,stage,backup,paths){
  const record=[];
  // Complete all backups before the first overwrite.
  for(const path of paths){
    await safeTarget(stage,path);const target=await safeTarget(root,path),saved=join(backup,path);let existed=false;
    try{const info=await lstat(target);if(!info.isFile())throw Error('Target is not a regular file');await mkdir(dirname(saved),{recursive:true});await copyFile(target,saved);existed=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    record.push({path,existed});
  }
  await mkdir(backup,{recursive:true});await writeFile(join(backup,'rollback.json'),JSON.stringify(record));return record;
}
async function replace(source,dest){await mkdir(dirname(dest),{recursive:true});const temp=dest+'.stockpilot-update-tmp';await copyFile(source,temp);await rename(temp,dest);}
export async function applySoftware(root,stage,record){
  for(const {path} of [...record.filter(r=>r.path!=='release.json'),...record.filter(r=>r.path==='release.json')])await replace(await safeTarget(stage,path),await safeTarget(root,path));
}
export async function rollbackSoftware(root,backup,record){
  for(const {path,existed} of record){const dest=await safeTarget(root,path);if(existed)await replace(join(backup,path),dest);else await rm(dest,{force:true});}
}
export async function snapshotData(dataDir,backup){
  await mkdir(backup,{recursive:true});
  for(const name of ['US.json','DE.json','access-code.txt'])try{await copyFile(join(dataDir,name),join(backup,name));}catch(e){if(e.code!=='ENOENT')throw e;}
}
