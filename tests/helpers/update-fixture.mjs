import { buildRelease, encodeZip, sha256 } from '../../scripts/update-archive.mjs';
export function releaseFixture(extra=[]){
 const entries=['dist/index.html','dist/us.html','dist/de.html','scripts/serve.mjs','scripts/store.mjs','scripts/reminder-agent.mjs','scripts/updater.mjs','scripts/apply-update.mjs','scripts/update-files.mjs','scripts/update-archive.mjs','src/engine.js','package.json','Start.vbs','windows/manage.ps1'].map(path=>[path,Buffer.from('new '+path)]);
 entries.push(...extra);const release=buildRelease(entries,'0.3.0');entries.push(['release.json',Buffer.from(JSON.stringify(release))]);
 const bytes=encodeZip(entries),manifest={schema:1,version:release.version,buildId:release.buildId,sha256:sha256(bytes),bytes:bytes.length};return {bytes,manifest,release,entries};
}
