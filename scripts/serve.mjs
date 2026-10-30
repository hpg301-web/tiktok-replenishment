import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { openStore } from './store.mjs';

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
export async function createApp(root, { dataDir=resolve(root,'../.stockpilot'), sessionMs=8*60*60*1000 }={}) {
  const store=await openStore(dataDir);
  const sessions=new Map(), attempts=new Map();
  function authorized(req) {
    const token=/(?:^|;\s*)stockpilot_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];
    for(const [k,v] of sessions) if(v<Date.now())sessions.delete(k);
    return !!token && sessions.has(token);
  }
  async function body(req) {
    const chunks=[];let size=0;
    for await(const chunk of req) {size+=chunk.length;if(size>10*1024*1024){const e=Error('文件超过10MB，请缩小导入范围');e.status=413;throw e;}chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=Error('无效JSON');e.status=400;throw e;}
  }
  const base = await realpath(root);
  const instance = createHash('sha256').update(base).digest('hex').slice(0,24);
  return createServer(async (req,res)=>{
    const finish = (status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:body);};
    if (req.url.startsWith('/api/')) {
      const json=(status,value)=>finish(status,JSON.stringify(value),mime['.json']);
      try {
        if(req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)return json(403,{error:'请求来源不匹配'});
        if(req.url==='/api/mode' && req.method==='GET')return json(200,{shared:true,authenticated:authorized(req)});
        if(req.url==='/api/login' && req.method==='POST') {
          const ip=req.socket.remoteAddress;
          let record=attempts.get(ip);
          if(!record||record.until<Date.now()){record={n:0,until:Date.now()+60000};attempts.set(ip,record);}
          for(const [k,v] of attempts)if(v.until<Date.now())attempts.delete(k);
          if(record.n++>=10)return json(429,{error:'尝试过于频繁，请一分钟后再试'});
          const input=await body(req),actual=Buffer.from(String(input.code||'')),expected=Buffer.from(store.accessCode);
          if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(401,{error:'访问口令不正确'});
          const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+sessionMs);
          res.setHeader('Set-Cookie',`stockpilot_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionMs/1000)}`);
          return json(200,{ok:true});
        }
        if(!authorized(req))return json(401,{error:'请登录团队工作区'});
        if(req.url==='/api/logout' && req.method==='POST'){
          const token=/(?:^|;\s*)stockpilot_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];sessions.delete(token);
          res.setHeader('Set-Cookie','stockpilot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});
        }
        const match=/^\/api\/workspace\/(US|DE)$/.exec(req.url);
        if(!match)return json(404,{error:'Not found'});
        if(req.method==='GET')return json(200,await store.read(match[1]));
        if(req.method==='PUT'){
          const revision=Number(req.headers['if-match']);
          if(req.headers['if-match']===undefined||!Number.isSafeInteger(revision)||revision<0)return json(428,{error:'缺少有效版本号'});
          const input=await body(req);
          let saved;try{saved=await store.save(match[1],input,revision);}catch(e){if(!e.status && !e.code)e.status=400;throw e;}
          return json(200,saved);
        }
        return json(405,{error:'Method not allowed'});
      }catch(e){console.error(e.code||e.status||'API error');return json(e.status||500,{error:e.status?e.message:'服务器数据读取失败，未覆盖已有文件；请联系管理员检查备份。'});}
    }
    if (!['GET','HEAD'].includes(req.method)) {res.setHeader('Allow','GET, HEAD');return finish(405,'Method not allowed');}
    try {
      const raw = req.url.split('?')[0];
      const path = decodeURIComponent(raw);
      if (path === '/_stockpilot/health') {
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return finish(404,'Not found');
        const port = req.socket.localPort;
        const addresses = [...new Set(Object.values(networkInterfaces()).flat().filter(n=>n && n.family==='IPv4'&&!n.internal).map(n=>`http://${n.address}:${port}/`))];
        return finish(200,JSON.stringify({app:'stockpilot-local',instance,pid:process.pid,addresses}),mime['.json']);
      }
      if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(p=>p==='..'||p.startsWith('.'))) return finish(403,'Forbidden');
      const candidate = resolve(base,'.'+(path==='/'?'/index.html':path));
      if (!candidate.startsWith(base+sep)) return finish(403,'Forbidden');
      const file = await realpath(candidate);
      if (!file.startsWith(base+sep)) return finish(403,'Forbidden');
      if (!(await stat(file)).isFile()) return finish(404,'Not found');
      finish(200,await readFile(file),mime[extname(file)]||'application/octet-stream');
    } catch(error) {
      if (error instanceof URIError) return finish(400,'Bad request');
      if (['ENOENT','ENOTDIR','EACCES','EISDIR'].includes(error.code)) return finish(404,'Not found');
      console.error(error.message);finish(500,'Server error');
    }
  });
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
  const port = Number(process.env.STOCKPILOT_PORT||5173);
  if (!Number.isInteger(port)||port<1||port>65535) throw Error('Invalid STOCKPILOT_PORT');
  const server = await createApp(root);
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use; stop the old development server first.`:e.message);process.exitCode=1;});
  server.listen(port,'0.0.0.0',()=>console.log(`StockPilot local deployment listening on ${port}`));
}
