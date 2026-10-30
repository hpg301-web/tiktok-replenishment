import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createApp} from '../../scripts/serve.mjs';
const skus=['TEST001_42D','TEST002_40C','KNOWN_S'];
function fixture(market='US'){const asOf='2026-10-30';return {asOf,sales:skus.map(sku=>({market,sku,date:asOf,units:1,...sku==='KNOWN_S'?{product:'TEST-SPU'}:{}})),inventory:skus.map(sku=>({market,sku,available:10,snapshot_date:asOf,...sku==='KNOWN_S'?{product:'TEST-SPU'}:{}})),pipeline:[]};}
let dir,server,url;
test.beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'stockpilot-classification-'));server=await createApp(resolve('dist'),{dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;});
test.afterEach(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
async function login(page){await page.goto(url);await page.getByLabel('访问口令',{exact:true}).fill((await readFile(join(dir,'access-code.txt'),'utf8')).trim());await page.getByRole('button',{name:'进入工作区'}).click();await page.getByRole('button',{name:'手动归类SKU',exact:true}).waitFor();}
async function upload(page,data){await page.locator('#json').setInputFiles({name:'workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(page.locator('#notice')).toContainText('已更新');}
test('bulk classification survives reload and table imports, is shared, and can restore automatic detection',async({page,browser})=>{
 await login(page);await upload(page,fixture());await expect(page.locator('details.product')).toHaveCount(3);
 await page.getByRole('button',{name:'手动归类SKU',exact:true}).click();await expect(page.locator('.classification-row')).toHaveCount(2);
 await page.getByRole('button',{name:'选择当前筛选结果',exact:true}).click();await page.getByLabel('目标SPU（可选已有或输入新建）').fill('TEST-SPU');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'保存归类',exact:true}).click();await expect(page.locator('.classification-dialog')).toHaveCount(0);
 await expect(page.locator('details.product')).toHaveCount(1);await expect(page.locator('details.product > summary')).toContainText('3 个 SKU');
 await page.reload();await expect(page.locator('details.product')).toHaveCount(1);
 const other=await browser.newContext();try{const coworker=await other.newPage();await login(coworker);await expect(coworker.locator('details.product')).toHaveCount(1);}finally{await other.close();}
 await page.locator('[data-kind="inventory"]').setInputFiles({name:'new-stock.csv',mimeType:'text/csv',buffer:Buffer.from('market,sku,product,available,snapshot_date\nUS,TEST001_42D,AUTO-DIFFERENT,11,2026-10-30\nUS,TEST002_40C,AUTO-DIFFERENT,12,2026-10-30\nUS,KNOWN_S,TEST-SPU,10,2026-10-30\n')});await expect(page.locator('#notice')).toContainText('已更新');await expect(page.locator('details.product')).toHaveCount(1);
 const saved=await(await page.request.get(url+'/api/workspace/US')).json();expect(saved.data.skuMappings['US|'+skus[0]]).toBe('TEST-SPU');expect(saved.data.inventory[0].product).toBe('AUTO-DIFFERENT');
 await page.getByRole('button',{name:'手动归类SKU',exact:true}).click();await page.locator('#classification-filter').selectOption('manual');await expect(page.locator('.classification-row')).toHaveCount(2);
 await page.getByRole('button',{name:'选择当前筛选结果',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'恢复所选SKU自动识别',exact:true}).click();await expect(page.locator('.classification-dialog')).toHaveCount(0);await expect(page.locator('details.product')).toHaveCount(2);await expect(page.locator('details.product > summary')).toContainText(['AUTO-DIFFERENT','TEST-SPU']);
 await page.getByRole('link',{name:'DE 德国工作区'}).click();await upload(page,fixture('DE'));await expect(page.locator('details.product')).toHaveCount(3);
});
test('classification from a stale workspace cannot overwrite a colleague mapping, even while the poll timer runs',async({page})=>{
 await page.clock.install();await login(page);await upload(page,fixture());
 await page.getByRole('button',{name:'手动归类SKU',exact:true}).click();await page.getByRole('button',{name:'选择当前筛选结果',exact:true}).click();
 const current=await(await page.request.get(url+'/api/workspace/US')).json();current.data.skuMappings={['US|'+skus[0]]:'COLLEAGUE-SPU'};
 const changed=await page.request.put(url+'/api/workspace/US',{headers:{'If-Match':String(current.revision)},data:{data:current.data,isDemo:false}});expect(changed.status()).toBe(200);
 await page.clock.runFor(6000);
 await page.getByLabel('目标SPU（可选已有或输入新建）').fill('TEST-SPU');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'保存归类',exact:true}).click();await expect(page.locator('#classification-error')).toContainText('同事已更新');
 const saved=await(await page.request.get(url+'/api/workspace/US')).json();expect(saved.data.skuMappings['US|'+skus[0]]).toBe('COLLEAGUE-SPU');expect(saved.data.skuMappings['US|'+skus[1]]).toBeUndefined();
 await page.locator('#classification-close').click();
});
