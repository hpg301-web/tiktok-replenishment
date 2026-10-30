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
const archive=encodeZip(entries),manifest={schema:1,version,buildId:release.buildId,sha256:sha256(archive),bytes:archive.length,notes:'新增SKU手动归类：批量归入已有或新建SPU、记住规则并应用到后续导入和提醒、可恢复自动识别。继续仅监控美国，保留SPU展开建议及在线更新。'};
await mkdir(resolve(root,'downloads'),{recursive:true});await writeFile(resolve(root,'downloads/StockPilot-Windows.zip'),archive);
await writeFile(resolve(root,'downloads/SHA256SUMS.txt'),manifest.sha256+'  StockPilot-Windows.zip\n');
await writeFile(resolve(root,'downloads/update.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Created Windows deployment and update manifest ('+entries.length+' files; no business data or credentials)');
