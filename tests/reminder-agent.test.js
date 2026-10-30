import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {request} from 'node:http';
import {assessWorkspace,createReminderAgent,DEFAULT_SETTINGS,validateSettings,clockParts} from '../scripts/reminder-agent.mjs';
import {openStore} from '../scripts/store.mjs';import {createApp} from '../scripts/serve.mjs';import {dateAt,dateNumber} from '../src/engine.js';
const day='2026-10-30';
function fixture(){return {revision:1,isDemo:false,data:{asOf:day,sales:Array.from({length:30},(_,n)=>({market:'US',sku:'001',product:'P',date:dateAt(dateNumber(day)-n),units:2,in_stock:true})),inventory:[{market:'US',sku:'001',product:'P',available:0,snapshot_date:day}],pipeline:[],overrides:{'US|P':'B'}}};}
async function setup(){const dir=await mkdtemp(join(tmpdir(),'stockpilot-agent-')),store=await openStore(dir);let clock=new Date('2026-10-30T00:50:00Z');const agent=await createReminderAgent({store,dataDir:dir,now:()=>clock});return {dir,store,agent,setClock:value=>clock=new Date(value),close:async()=>{await agent.stop();await rm(dir,{recursive:true,force:true});}};}
test('fresh data identifies overdue replenishment and unavoidable stockout; stop/demo never become purchase instructions',()=>{
 const saved=fixture(),alerts=assessWorkspace(saved,'US',{today:day,lookAheadDays:7});
 assert.ok(alerts.some(a=>a.type==='replenish'&&a.mode==='sea'&&a.sea>0&&a.level==='urgent'));
 assert.ok(alerts.some(a=>a.type==='stockout'&&a.message.includes('无法弥补')));
 saved.data.productSignals={'US|P':{discontinued:true}};assert.equal(assessWorkspace(saved,'US',{today:day,lookAheadDays:7}).filter(a=>['replenish','stockout'].includes(a.type)).length,0);
 saved.isDemo=true;const demo=assessWorkspace(saved,'US',{today:day,lookAheadDays:7});assert.equal(demo.length,1);assert.equal(demo[0].type,'demo');assert.equal(demo[0].sea,null);
});
test('stale/future data and missing snapshots never generate executable amounts',()=>{
 for(const today of ['2026-10-29','2026-10-31']){const alerts=assessWorkspace(fixture(),'US',{today,lookAheadDays:7});assert.equal(alerts.length,1);assert.equal(alerts[0].type,'data-stale');assert.equal(alerts[0].sea,null);}
 const empty=fixture();empty.data.sales=[];assert.equal(assessWorkspace(empty,'US',{today:day,lookAheadDays:7})[0].type,'data-missing-sales');
 const saved=fixture();saved.data.inventory=[];const alerts=assessWorkspace(saved,'US',{today:day,lookAheadDays:7});assert.ok(alerts.some(a=>a.type==='stock-unverified'));assert.ok(!alerts.some(a=>a.type==='replenish'));
});
test('unknown and overdue pipeline is flagged, completed shipments excluded',()=>{
 const saved=fixture();saved.data.pipeline=[{market:'US',sku:'001',qty:10,shipment_id:'one',eta:''},{market:'US',sku:'001',qty:20,shipment_id:'two',eta:'2026-10-29'},{market:'US',sku:'001',qty:30,shipment_id:'three',eta:'2026-10-29',status:'completed'}];
 const alerts=assessWorkspace(saved,'US',{today:day,lookAheadDays:7});assert.equal(alerts.filter(a=>a.type.startsWith('pipeline-')).length,2);assert.ok(!JSON.stringify(alerts).includes('three'));
});
test('daily summary and urgent changes are deduplicated; acknowledgements persist and stale data only prompts refresh',async()=>{
 const s=await setup();try{
  await s.store.save('US',{data:fixture().data},0);
  let settings={...DEFAULT_SETTINGS,markets:['US'],notifyOnUrgent:false};await s.agent.saveSettings(settings,0);
  let snap=await s.agent.check();assert.equal(snap.notification,null);
  s.setClock('2026-10-30T01:01:00Z');snap=await s.agent.check();const notification=snap.notification.id;
  s.setClock('2026-10-30T01:20:00Z');assert.equal((await s.agent.check()).notification.id,notification);
  const first=snap.alerts[0];snap=await s.agent.acknowledge(first.id,first.fingerprint);assert.ok(snap.alerts.find(a=>a.id===first.id).read);
  await s.agent.stop();const restarted=await createReminderAgent({store:s.store,dataDir:s.dir,now:()=>new Date('2026-10-30T01:30:00Z')});
  assert.ok((await restarted.snapshot()).alerts.find(a=>a.id===first.id).read);await restarted.stop();
  s.agent.resume();s.setClock('2026-10-31T01:01:00Z');snap=await s.agent.check();assert.ok(snap.alerts.every(a=>a.type==='data-stale'&&a.sea===null));assert.notEqual(snap.notification.id,notification);
 }finally{await s.close();}
});
test('new urgent risk notifies immediately; unchanged polling does not re-notify',async()=>{
 const s=await setup();try{await s.store.save('US',{data:fixture().data},0);const first=await s.agent.check();assert.equal(first.notification.reason,'urgent');s.setClock('2026-10-30T00:55:00Z');assert.equal((await s.agent.check()).notification.id,first.notification.id);
 const data=fixture().data;data.inventory[0].available=3;await s.store.save('US',{data},1);assert.notEqual((await s.agent.check()).notification.id,first.notification.id);
 }finally{await s.close();}
});
test('settings and read state are protected from maintenance; pause drains writes before backup',async()=>{
 const s=await setup();try{await s.store.save('US',{data:fixture().data},0);const snap=await s.agent.check();const bytes=await readFile(join(s.dir,'agent-state.json'));await s.agent.pause();assert.equal((await s.agent.check()).maintenance,true);assert.deepEqual(await readFile(join(s.dir,'agent-state.json')),bytes);
 await assert.rejects(s.agent.saveSettings(DEFAULT_SETTINGS,0),/更新期间/);await assert.rejects(s.agent.acknowledge(snap.alerts[0].id,snap.alerts[0].fingerprint),/更新期间/);
 s.agent.resume();await assert.rejects(s.agent.acknowledge(snap.alerts[0].id,'old fingerprint'),/变化/);
 }finally{await s.close();}
});
test('calendar settings validate and disabled agent produces no alerts or notifications',async()=>{
 assert.deepEqual(clockParts(new Date('2026-10-30T01:00:00Z'),'Asia/Shanghai'),{date:'2026-10-30',time:'09:00'});
 for(const invalid of [{dailyTime:'25:00'},{intervalMinutes:0},{markets:['XX']},{timeZone:'Invalid/Zone'}])assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,...invalid}));
 const s=await setup();try{await s.store.save('US',{data:fixture().data},0);await s.agent.check();const snap=await s.agent.saveSettings({...DEFAULT_SETTINGS,enabled:false},0);assert.equal(snap.enabled,false);assert.equal(snap.alerts.length,0);assert.equal(snap.notification,null);}finally{await s.close();}
});
test('heartbeat runs unattended and notices a new calendar date',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stockpilot-agent-timer-')),store=await openStore(dir);let clock=new Date('2026-10-30T01:00:00Z');const agent=await createReminderAgent({store,dataDir:dir,now:()=>clock,heartbeatMs:20});
 try{agent.start();for(let n=0;n<50;n++){await new Promise(r=>setTimeout(r,20));try{if(JSON.parse(await readFile(join(dir,'agent-state.json'),'utf8')).checkedDate===day)break;}catch{}}
  assert.equal(JSON.parse(await readFile(join(dir,'agent-state.json'),'utf8')).checkedDate,day);clock=new Date('2026-10-31T01:00:00Z');
  for(let n=0;n<50;n++){await new Promise(r=>setTimeout(r,20));if(JSON.parse(await readFile(join(dir,'agent-state.json'),'utf8')).checkedDate==='2026-10-31')break;}
  assert.equal(JSON.parse(await readFile(join(dir,'agent-state.json'),'utf8')).checkedDate,'2026-10-31');
 }finally{await agent.stop();await rm(dir,{recursive:true,force:true});}
});
test('agent endpoints require login; only localhost changes settings; corrupt reminder files do not break workspaces',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stockpilot-agent-api-'));let server;
 try{
  server=await createApp(resolve('dist'),{dataDir:dir,agentOptions:{now:()=>new Date('2026-10-30T01:00:00Z')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/api/agent')).status,401);let login=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({code:(await readFile(join(dir,'access-code.txt'),'utf8')).trim()})});let Cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url+'/api/agent')).status,401);assert.equal((await fetch(url+'/api/agent',{headers:{Cookie}})).status,200);
  const lan=await new Promise((resolve,reject)=>{const req=request(url+'/api/agent/settings',{method:'PUT',headers:{Cookie,Host:'192.168.1.150:5173'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);req.end(JSON.stringify({revision:0,settings:DEFAULT_SETTINGS}));});assert.equal(lan,403);
  assert.equal((await fetch(url+'/api/agent/settings',{method:'PUT',headers:{Cookie},body:JSON.stringify({revision:0,settings:DEFAULT_SETTINGS})})).status,200);
  assert.equal((await fetch(url+'/api/agent/settings',{method:'PUT',headers:{Cookie},body:JSON.stringify({revision:0,settings:DEFAULT_SETTINGS})})).status,409);
  await new Promise(r=>server.close(r));server=null;await writeFile(join(dir,'agent-state.json'),'corrupt');
  server=await createApp(resolve('dist'),{dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;
  login=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({code:(await readFile(join(dir,'access-code.txt'),'utf8')).trim()})});Cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url+'/api/workspace/US',{headers:{Cookie}})).status,200);assert.equal((await fetch(url+'/api/agent',{headers:{Cookie}})).status,503);assert.equal(await readFile(join(dir,'agent-state.json'),'utf8'),'corrupt');
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
test('legacy Germany-enabled settings are limited to US without modifying files during update',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stockpilot-agent-us-only-'));
 const config={revision:5,settings:{...DEFAULT_SETTINGS,markets:['US','DE'],dailyTime:'11:00',lookAheadDays:9}};
 await writeFile(join(dir,'agent-settings.json'),JSON.stringify(config));
 const previous={schema:1,alerts:[{id:'old-us',market:'US',level:'urgent',fingerprint:'us'},{id:'old-de',market:'DE',level:'urgent',fingerprint:'de'}],acks:{},history:[],notification:{id:'old-mixed'},lastDailyDay:day,lastUrgentSignature:'old',lastCheckedAt:'2026-10-30T01:30:00Z',checkedDate:day};
 await writeFile(join(dir,'agent-state.json'),JSON.stringify(previous));await writeFile(join(dir,'DE.json'),'DE workspace stays untouched');await writeFile(join(dir,'update-lock'),'update');
 const before=await readFile(join(dir,'agent-settings.json')),beforeState=await readFile(join(dir,'agent-state.json'));const reads=[];
 const agent=await createReminderAgent({dataDir:dir,store:{read:async market=>{reads.push(market);return fixture();}},now:()=>new Date('2026-10-30T01:30:00Z')});
 try{
  let snap=await agent.snapshot();assert.deepEqual(snap.settings.markets,['US']);assert.ok(snap.alerts.every(a=>a.market==='US'));assert.equal(snap.notification,null);assert.deepEqual(await readFile(join(dir,'agent-settings.json')),before);assert.deepEqual(await readFile(join(dir,'agent-state.json')),beforeState);
  await rm(join(dir,'update-lock'));snap=await agent.snapshot();assert.deepEqual(reads,['US']);assert.equal(snap.settings.dailyTime,'11:00');assert.equal(snap.settings.lookAheadDays,9);assert.ok(snap.alerts.every(a=>a.market==='US'&&a.spu==='P'));assert.equal(await readFile(join(dir,'DE.json'),'utf8'),'DE workspace stays untouched');
  await assert.rejects(agent.saveSettings({...DEFAULT_SETTINGS,markets:['DE']},5),/仅监控美国/);
 }finally{await agent.stop();await rm(dir,{recursive:true,force:true});}
});
