import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../scripts/serve.mjs';
async function setup() {
  const root=await mkdtemp(join(tmpdir(),'stockpilot-test-')),dist=join(root,'dist'),dataDir=join(root,'private');
  await mkdir(dist);await writeFile(join(dist,'index.html'),'<title>StockPilot</title>');await writeFile(join(dist,'us.html'),'US');
  const server=await createApp(dist,{dataDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  const code=(await readFile(join(dataDir,'access-code.txt'),'utf8')).trim();
  const login=async()=>{const r=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  return {root,dist,dataDir,url,server,login,async close(){await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}};
}
const data=market=>({asOf:'2026-10-30',sales:[],inventory:[{market,sku:'001',available:2,snapshot_date:'2026-10-30'}],pipeline:[]});
test('deployment only exposes static assets, not source, traversal or business files',async()=>{
  const s=await setup();try{
    assert.equal((await fetch(s.url+'/')).status,200);assert.equal((await fetch(s.url+'/us.html')).status,200);
    assert.equal((await fetch(s.url+'/src/engine.js')).status,404);
    assert.equal((await fetch(s.url+'/%2e%2e%2fprivate/access-code.txt')).status,403);
    assert.equal((await fetch(s.url+'/.stockpilot/access-code.txt')).status,403);
    assert.equal((await fetch(s.url+'/%ZZ')).status,400);
    await writeFile(join(s.root,'secret.txt'),'private');await symlink(join(s.root,'secret.txt'),join(s.dist,'link.txt'));
    assert.equal((await fetch(s.url+'/link.txt')).status,403);
  }finally{await s.close();}
});
test('login is required; cross-origin writes and stale versions rejected',async()=>{
  const s=await setup();try{
    assert.equal((await fetch(s.url+'/api/workspace/US')).status,401);
    assert.equal((await fetch(s.url+'/api/login',{method:'POST',body:JSON.stringify({code:'wrong'})})).status,401);
    const cookie=await s.login(),headers={Cookie:cookie,'Content-Type':'application/json','If-Match':'0'};
    assert.equal((await fetch(s.url+'/api/workspace/US',{method:'PUT',headers:{...headers,Origin:'http://evil.invalid'},body:JSON.stringify({data:data('US')})})).status,403);
    const saves=await Promise.all([1,2].map(()=>fetch(s.url+'/api/workspace/US',{method:'PUT',headers,body:JSON.stringify({data:data('US')})})));
    assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
    const latest=await (await fetch(s.url+'/api/workspace/US',{headers:{Cookie:cookie}})).json();assert.equal(latest.revision,1);assert.equal(latest.data.inventory[0].sku,'001');
    const second=await s.login();assert.equal((await (await fetch(s.url+'/api/workspace/US',{headers:{Cookie:second}})).json()).revision,1);
    assert.equal((await (await fetch(s.url+'/api/workspace/DE',{headers:{Cookie:second}})).json()).revision,0);
    assert.equal((await fetch(s.url+'/api/workspace/US',{method:'PUT',headers:{...headers,'If-Match':'1'},body:JSON.stringify({data:data('DE')})})).status,400);
    assert.equal((await fetch(s.url+'/api/logout',{method:'POST',headers:{Cookie:cookie}})).status,200);
    assert.equal((await fetch(s.url+'/api/workspace/US',{headers:{Cookie:cookie}})).status,401);
  }finally{await s.close();}
});
test('workspaces persist across restarts, backup previous version; corruption never becomes an empty save',async()=>{
  const s=await setup();try{
    const cookie=await s.login();
    for(const revision of [0,1])assert.equal((await fetch(s.url+'/api/workspace/US',{method:'PUT',headers:{Cookie:cookie,'If-Match':String(revision)},body:JSON.stringify({data:data('US')})})).status,200);
    assert.equal((await readdir(join(s.dataDir,'backups'))).length,1);
    const second=await createApp(s.dist,{dataDir:s.dataDir});await new Promise(r=>second.listen(0,'127.0.0.1',r));
    try{const url='http://127.0.0.1:'+second.address().port;const code=await readFile(join(s.dataDir,'access-code.txt'),'utf8');const r=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({code})});const c=r.headers.get('set-cookie').split(';')[0];const restored=await (await fetch(url+'/api/workspace/US',{headers:{Cookie:c}})).json();assert.equal(restored.revision,2);}finally{await new Promise(r=>second.close(r));}
    await writeFile(join(s.dataDir,'US.json'),'corrupt');
    assert.equal((await fetch(s.url+'/api/workspace/US',{headers:{Cookie:cookie}})).status,500);
    assert.equal(await readFile(join(s.dataDir,'US.json'),'utf8'),'corrupt');
  }finally{await s.close();}
});
