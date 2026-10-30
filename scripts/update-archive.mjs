import { createHash } from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function allowedFile(path){
  return /^(?:dist\/(?:index|us|de)\.html|dist\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|map|woff2?|png|svg|ico)|scripts\/[a-z][a-z0-9-]*\.mjs|src\/engine\.js|windows\/(?:manage\.ps1|README-Windows\.md)|(?:Start|Stop|Enable-startup|Disable-startup|LAN-address|Enable-LAN)\.vbs|package\.json|release\.json)$/.test(path) && !path.split('/').some(p=>p==='..'||p.startsWith('.'));
}
export function encodeZip(entries){
  const locals=[],directory=[];let offset=0;
  for(const [path,data] of entries){
    const name=Buffer.from('StockPilot/'+path),crc=crc32(data),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);locals.push(header,name,data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);directory.push(c,name);offset+=header.length+name.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
export function buildRelease(entries,version){
  const files=entries.map(([path,bytes])=>({path,sha256:sha256(bytes)}));
  const buildId=sha256(Buffer.from(JSON.stringify(files)));
  return {schema:1,version,buildId,files};
}
export function verifyArchive(bytes,manifest){
  if(bytes.length!==manifest.bytes||sha256(bytes)!==manifest.sha256)throw Error('更新包完整性校验失败，未安装');
  if(bytes.length<22||bytes.readUInt32LE(bytes.length-22)!==0x06054b50)throw Error('更新包目录无效');
  const end=bytes.length-22,count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
  if(count<1||count>2000||start+size!==end||bytes.readUInt16LE(end+8)!==count)throw Error('更新包目录边界无效');
  const files=new Map(),names=new Set();let p=start;
  for(let i=0;i<count;i++){
    if(p+46>end||bytes.readUInt32LE(p)!==0x02014b50)throw Error('更新包目录损坏');
    const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),compressed=bytes.readUInt32LE(p+20),length=bytes.readUInt32LE(p+24),nameLength=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),local=bytes.readUInt32LE(p+42);
    const name=bytes.subarray(p+46,p+46+nameLength).toString('utf8'),path=name.slice('StockPilot/'.length);
    if(!name.startsWith('StockPilot/')||!allowedFile(path)||names.has(path.toLowerCase()))throw Error('更新包含不允许的路径');
    if(flags&9||method!==0||compressed!==length||(bytes.readUInt32LE(p+38)>>>16&0xf000)===0xa000)throw Error('不支持的更新包文件类型');
    if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)!==flags)throw Error('更新包本地目录损坏');
    const n=bytes.readUInt16LE(local+26),x=bytes.readUInt16LE(local+28),begin=local+30+n+x;
    if(begin+length>start||bytes.subarray(local+30,local+30+n).toString('utf8')!==name)throw Error('更新包文件边界无效');
    const data=bytes.subarray(begin,begin+length);
    if(crc32(data)!==bytes.readUInt32LE(p+16))throw Error('更新包文件校验失败');
    names.add(path.toLowerCase());files.set(path,data);p+=46+nameLength+extra+comment;
  }
  if(p!==end)throw Error('更新包目录长度无效');
  const release=JSON.parse(files.get('release.json')?.toString()||'null');
  if(!release||release.version!==manifest.version||release.buildId!==manifest.buildId||!Array.isArray(release.files)||release.files.length!==files.size-1)throw Error('更新版本元数据不匹配');
  const seen=new Set();
  for(const f of release.files){if(!allowedFile(f.path)||f.path==='release.json'||seen.has(f.path)||!files.has(f.path)||sha256(files.get(f.path))!==f.sha256)throw Error('更新文件清单校验失败');seen.add(f.path);}
  if(sha256(Buffer.from(JSON.stringify(release.files)))!==release.buildId)throw Error('更新构建标识无效');
  for(const required of ['dist/index.html','dist/us.html','dist/de.html','scripts/serve.mjs','scripts/store.mjs','scripts/reminder-agent.mjs','scripts/updater.mjs','scripts/apply-update.mjs','scripts/update-files.mjs','scripts/update-archive.mjs','src/engine.js','package.json','Start.vbs','windows/manage.ps1'])if(!files.has(required))throw Error('更新包缺少必要文件');
  return {files,release};
}
