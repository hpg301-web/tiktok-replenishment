import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {openStore} from '../scripts/store.mjs';import {createReminderAgent,DEFAULT_SETTINGS} from '../scripts/reminder-agent.mjs';import {createApp} from '../scripts/serve.mjs';
function data(market='US'){return {asOf:'2026-10-30',sales:[{market,sku:'001-M',date:'2026-10-30',units:2}],inventory:[{market,sku:'001-M',available:3,snapshot_date:'2026-10-30'}],pipeline:[{market,sku:'001-M',qty:5,eta:'2026-11-10',shipment_id:'SYNTHETIC-SHIP'}],skuMappings:{[market+'|001-M']:'TEST-SPU'},overrides:{[market+'|TEST-SPU']:'B'},productSignals:{[market+'|TEST-SPU']:{unitCost:2}},routes:{[market]:{sea:35}},imports:{sales:{source:'synthetic',fileName:'synthetic.csv'}}};}
async function setup(){const dir=await mkdtemp(join(tmpdir(),'stockpilot-clear-'));const store=await openStore(dir);await store.save('US',{data:data()},0);await store.save('DE',{data:data('DE')},0);return {dir,store,close:()=>rm(dir,{recursive:true,force:true})};}
test('clear requires explicit confirmation/current revision and never changes data on refusal',async()=>{
 const s=await setup();try{const original=await readFile(join(s.dir,'US.json')),backups=await readdir(join(s.dir,'backups'));const hooks={pause:async()=>{throw Error('should not run');},resetWorkspace:async()=>{},resume(){}};
 for(const input of [{},{confirmed:false},{confirmed:'true'}])assert.throws(()=>s.store.clearUS(input,1,hooks),/确认/);
 await assert.rejects(s.store.clearUS({confirmed:true},0,hooks),/同事已更新/);assert.deepEqual(await readFile(join(s.dir,'US.json')),original);assert.deepEqual(await readdir(join(s.dir,'backups')),backups);
 }finally{await s.close();}
});
test('confirmed reset clears US business data and reminder history, preserving DE, credentials, schedule and backups',async()=>{
 const s=await setup();const agent=await createReminderAgent({store:s.store,dataDir:s.dir,now:()=>new Date('2026-10-30T01:30:00Z')});
 try{await agent.saveSettings({...DEFAULT_SETTINGS,dailyTime:'10:30'},0);await agent.check();const original=await readFile(join(s.dir,'US.json')),de=await readFile(join(s.dir,'DE.json')),code=await readFile(join(s.dir,'access-code.txt')),settings=await readFile(join(s.dir,'agent-settings.json'));
 const cleared=await s.store.clearUS({confirmed:true},1,{pause:()=>agent.pause(),resetWorkspace:()=>agent.resetWorkspace(),resume:()=>agent.resume()});
 assert.equal(cleared.revision,2);for(const key of ['sales','inventory','pipeline'])assert.deepEqual(cleared.data[key],[]);for(const key of ['skuMappings','overrides','productSignals','routes'])assert.deepEqual(cleared.data[key],{});assert.equal(cleared.data.imports,undefined);
 const state=JSON.parse(await readFile(join(s.dir,'agent-state.json'),'utf8'));assert.deepEqual(state.alerts,[]);assert.deepEqual(state.history,[]);assert.deepEqual(state.acks,{});assert.equal(state.notification,null);
 assert.deepEqual(await readFile(join(s.dir,'DE.json')),de);assert.deepEqual(await readFile(join(s.dir,'access-code.txt')),code);assert.deepEqual(await readFile(join(s.dir,'agent-settings.json')),settings);
 const files=await readdir(join(s.dir,'backups')),backup=files.find(n=>n.startsWith('US.before-clear.'));assert.ok(backup);assert.deepEqual(await readFile(join(s.dir,'backups',backup)),original);assert.ok(files.some(n=>n.startsWith('agent-state.before-US-clear.')));
 }finally{await agent.stop();await s.close();}
});
test('failure to clear reminder state restores exact original US file; software maintenance refuses clearing',async()=>{
 const s=await setup();try{const original=await readFile(join(s.dir,'US.json'));let resumed=false;
 await assert.rejects(s.store.clearUS({confirmed:true},1,{pause:async()=>{},resetWorkspace:async()=>{throw Error('simulated state disk failure');},resume(){resumed=true;}}),/原美国工作区已保留/);assert.equal(resumed,true);assert.deepEqual(await readFile(join(s.dir,'US.json')),original);
 await s.store.pause();assert.throws(()=>s.store.clearUS({confirmed:true},1,{}),/正在更新/);s.store.resume();
 }finally{await s.close();}
});
test('HTTP clear endpoint rejects guests, GET, unconfirmed/cross-origin requests and stale versions',async()=>{
 const s=await setup();let server;try{
 server=await createApp(resolve('dist'),{dataDir:s.dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port,endpoint=url+'/api/workspace/US/clear';
 assert.equal((await fetch(endpoint,{method:'POST',body:JSON.stringify({confirmed:true})})).status,401);
 const login=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({code:s.store.accessCode})});const Cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie,'If-Match':'1'};
 assert.equal((await fetch(endpoint,{headers})).status,405);assert.equal((await fetch(endpoint,{method:'POST',headers,body:'{}'})).status,400);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Origin:'http://evil.invalid'},body:'{"confirmed":true}'})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,'If-Match':'0'},body:'{"confirmed":true}'})).status,409);
 const original=await readFile(join(s.dir,'US.json'));await writeFile(join(s.dir,'update-lock'),'update');assert.equal((await fetch(endpoint,{method:'POST',headers,body:'{"confirmed":true}'})).status,503);assert.deepEqual(await readFile(join(s.dir,'US.json')),original);await rm(join(s.dir,'update-lock'));
 assert.equal((await fetch(endpoint,{method:'POST',headers,body:'{"confirmed":true}'})).status,200);
 }finally{if(server)await new Promise(r=>server.close(r));await s.close();}
});
