import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { releaseFixture } from './helpers/update-fixture.mjs';
import { verifyArchive } from '../scripts/update-archive.mjs';
import { stageFiles, snapshotData, safeTarget } from '../scripts/update-files.mjs';
import { createUpdater, validManifest } from '../scripts/updater.mjs';
import { runUpdate, verifyStage } from '../scripts/apply-update.mjs';
import { openStore } from '../scripts/store.mjs';
import { createApp } from '../scripts/serve.mjs';
async function setup(){const root=await mkdtemp(join(tmpdir(),'stockpilot-update-test-'));const dataDir=join(root,'.stockpilot');await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'OLD HTML');const store=await openStore(dataDir);const fixture=releaseFixture();const current={version:'0.2.0',buildId:'a'.repeat(64)};const download=async file=>file==='update.json'?Buffer.from(JSON.stringify(fixture.manifest)):fixture.bytes;return {root,dataDir,store,fixture,current,download,close:()=>rm(root,{recursive:true,force:true})};}
const workspace={asOf:'2026-10-30',sales:[],inventory:[],pipeline:[]};
test('archive checksum, scope and duplicate-path failures never extract business files',async()=>{
 const f=releaseFixture();assert.equal(verifyArchive(f.bytes,f.manifest).files.size,f.entries.length);
 const damaged=Buffer.from(f.bytes);damaged[45]^=1;assert.throws(()=>verifyArchive(damaged,f.manifest),/完整性/);
 for(const bad of ['../escape.txt','.stockpilot/US.json','scripts/../../escape.mjs','C:/evil.mjs','Start.vbs']){const x=releaseFixture([[bad,Buffer.from('bad')]]);assert.throws(()=>verifyArchive(x.bytes,x.manifest),/路径/);}
 assert.throws(()=>validManifest({...f.manifest,sha256:'x'.repeat(64)}),/无效/);
 await assert.rejects(safeTarget('/tmp','../evil'));
});
test('failed check/download keeps live version writable; downgrade and unconfirmed install refused',async()=>{
 const s=await setup();try{
  let downloads=0;
  const broken=createUpdater({...s,platform:'win32',shutdown(){},download:async()=>{downloads++;throw Error('offline');}});
  await assert.rejects(broken.check(),/暂时无法/);assert.equal(downloads,1);assert.equal((await s.store.save('US',{data:workspace},0)).revision,1);
  const updater=createUpdater({...s,platform:'win32',shutdown(){},launch:async()=>{}});
  await assert.rejects(updater.install({confirmed:true,buildId:s.fixture.manifest.buildId}),/先检查/);
  const next=await updater.check();assert.equal(next.available,true);
  await assert.rejects(updater.install({confirmed:false,buildId:next.buildId}),/确认/);
  const older=createUpdater({...s,current:{version:'9.0.0',buildId:'a'.repeat(64)},download:s.download,platform:'win32',shutdown(){}});assert.equal((await older.check()).available,false);
 }finally{await s.close();}
});
test('validated install pauses writes, snapshots exact data and hands off a job; corrupt stage is refused',async()=>{
 const s=await setup();try{
  await s.store.save('US',{data:workspace},0);let launched,shutdown=false;
  const updater=createUpdater({...s,platform:'win32',launch:async file=>{launched=file;},shutdown(){shutdown=true;}});
  const next=await updater.check();await updater.install({confirmed:true,buildId:next.buildId});
  assert.ok(launched);const job=JSON.parse(await readFile(launched,'utf8'));
  assert.deepEqual(await readFile(join(job.jobDir,'data-backup/US.json')),await readFile(join(s.dataDir,'US.json')));
  assert.throws(()=>s.store.save('US',{data:workspace},1),/正在更新/);
  assert.equal(await readFile(join(s.root,'dist/index.html'),'utf8'),'OLD HTML');
  await verifyStage(job);await writeFile(join(job.stage,'dist/index.html'),'tampered');await assert.rejects(verifyStage(job),/changed/);
  await new Promise(r=>setTimeout(r,350));assert.equal(shutdown,true);
 }finally{await s.close();}
});
test('corrupt download never freezes or alters the installation',async()=>{
 const s=await setup();try{
  const updater=createUpdater({...s,platform:'win32',shutdown(){},download:async file=>file==='update.json'?s.download(file):Buffer.from('corrupt')});
  const next=await updater.check();await assert.rejects(updater.install({confirmed:true,buildId:next.buildId}),/完整性/);
  assert.equal(existsSync(join(s.dataDir,'update-lock')),false);assert.equal((await s.store.save('US',{data:workspace},0)).revision,1);assert.equal(await readFile(join(s.root,'dist/index.html'),'utf8'),'OLD HTML');
 }finally{await s.close();}
});
test('worker success preserves data; failed new startup restores old software and data',async()=>{
 for(const shouldFail of [false,true]){
  const s=await setup();try{
   await s.store.save('US',{data:workspace},0);const original=await readFile(join(s.dataDir,'US.json'));
   const jobDir=join(s.dataDir,'updates/job'),stage=join(jobDir,'stage');await stageFiles(stage,verifyArchive(s.fixture.bytes,s.fixture.manifest).files);await snapshotData(s.dataDir,join(jobDir,'data-backup'));await writeFile(join(s.dataDir,'update-lock'),'job');
   const job={root:s.root,dataDir:s.dataDir,jobDir,stage,paths:s.fixture.entries.map(([p])=>p),version:s.fixture.release.version,buildId:s.fixture.release.buildId};let starts=0;
   await runUpdate(job,{wait:async()=>{},start:async()=>{starts++;if(shouldFail&&starts===1)throw Error('new startup failed');return {kill(){}};}});
   const status=JSON.parse(await readFile(join(s.dataDir,'update-status.json'),'utf8'));
   assert.equal(status.phase,shouldFail?'rolled-back':'succeeded');assert.equal(starts,shouldFail?2:1);
   assert.deepEqual(await readFile(join(s.dataDir,'US.json')),original);assert.equal(existsSync(join(s.dataDir,'update-lock')),false);
   assert.equal(await readFile(join(s.root,'dist/index.html'),'utf8'),shouldFail?'OLD HTML':'new dist/index.html');
  }finally{await s.close();}
 }
});
test('update APIs require login and localhost host; maintenance blocks writes',async()=>{
 const s=await setup();let server;
 try{
  const updater=createUpdater({...s,platform:'win32',shutdown(){}});
  server=await createApp(join(s.root,'dist'),{dataDir:s.dataDir,updaterFactory:()=>updater});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/api/update/check',{method:'POST'})).status,401);
  const login=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({code:s.store.accessCode})});const Cookie=login.headers.get('set-cookie').split(';')[0];
  const lanStatus=await new Promise((resolve,reject)=>{const req=request(url+'/api/update/check',{method:'POST',headers:{Cookie,Host:'192.168.1.150:5173'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(lanStatus,403);
  assert.equal((await fetch(url+'/api/update/check',{method:'POST',headers:{Cookie,Origin:'http://evil.invalid'}})).status,403);
  assert.equal((await fetch(url+'/api/update/install',{method:'GET',headers:{Cookie}})).status,405);
  assert.equal((await fetch(url+'/api/update/check',{method:'POST',headers:{Cookie}})).status,200);
  await writeFile(join(s.dataDir,'update-lock'),'updating');
  assert.equal((await fetch(url+'/api/workspace/US',{method:'PUT',headers:{Cookie,'If-Match':'0'},body:JSON.stringify({data:workspace})})).status,503);
 }finally{if(server)await new Promise(r=>server.close(r));await s.close();}
});
