// Dependency-free reproducible ZIP writer (stored entries, UTF-8 filenames).
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
const root=resolve(import.meta.dirname,'..');
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
const files=[];
async function add(path){const full=resolve(root,path),entries=await readdir(full,{withFileTypes:true});for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const p=path+'/'+entry.name;if(entry.isDirectory())await add(p);else files.push(p);}}
await add('dist');
files.push('scripts/serve.mjs','scripts/store.mjs','src/engine.js','package.json','windows/manage.ps1','Start.vbs','Stop.vbs','Enable-startup.vbs','Disable-startup.vbs','LAN-address.vbs','Enable-LAN.vbs','windows/README-Windows.md');
const locals=[],directory=[];let offset=0;
for(const file of files){
  const data=await readFile(resolve(root,file)),name=Buffer.from('StockPilot/'+relative(root,resolve(root,file)).replaceAll('\\','/'));
  const crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  locals.push(header,name,data);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);directory.push(c,name);offset+=header.length+name.length+data.length;
}
const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
const archive=Buffer.concat([...locals,central,end]);
await mkdir(resolve(root,'downloads'),{recursive:true});await writeFile(resolve(root,'downloads/StockPilot-Windows.zip'),archive);
await writeFile(resolve(root,'downloads/SHA256SUMS.txt'),createHash('sha256').update(archive).digest('hex')+'  StockPilot-Windows.zip\n');
console.log('Created downloads/StockPilot-Windows.zip ('+files.length+' files; no credentials or business data)');
