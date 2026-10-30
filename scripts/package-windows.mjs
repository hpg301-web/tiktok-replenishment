import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeZip, buildRelease, sha256 } from './update-archive.mjs';
const root=resolve(import.meta.dirname,'..'),files=[];
async function add(path){for(const entry of (await readdir(resolve(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path+'/'+entry.name;if(entry.isDirectory())await add(p);else files.push(p);}}
await add('dist');
files.push('scripts/serve.mjs','scripts/store.mjs','scripts/reminder-agent.mjs','scripts/updater.mjs','scripts/apply-update.mjs','scripts/update-files.mjs','scripts/update-archive.mjs','src/engine.js','package.json','windows/manage.ps1','Start.vbs','Stop.vbs','Enable-startup.vbs','Disable-startup.vbs','LAN-address.vbs','Enable-LAN.vbs','windows/README-Windows.md');
const entries=await Promise.all(files.map(async file=>[file,await readFile(resolve(root,file))]));
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const release=buildRelease(entries,version);entries.push(['release.json',Buffer.from(JSON.stringify(release))]);
const archive=encodeZip(entries),manifest={schema:1,version,buildId:release.buildId,sha256:sha256(archive),bytes:archive.length,notes:'新增美国工作区清除历史记录：必须点击确认才执行，取消不清除；自动备份并保留其他市场、口令及Agent定时设置，防止并发误删。'};
await mkdir(resolve(root,'downloads'),{recursive:true});await writeFile(resolve(root,'downloads/StockPilot-Windows.zip'),archive);
await writeFile(resolve(root,'downloads/SHA256SUMS.txt'),manifest.sha256+'  StockPilot-Windows.zip\n');
await writeFile(resolve(root,'downloads/update.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Created Windows deployment and update manifest ('+entries.length+' files; no business data or credentials)');
