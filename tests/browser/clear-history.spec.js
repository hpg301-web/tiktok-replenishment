import {test,expect} from '@playwright/test';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createApp} from '../../scripts/serve.mjs';
const source={asOf:'2026-10-30',sales:[{market:'US',sku:'TEST-001',date:'2026-10-30',units:2}],inventory:[{market:'US',sku:'TEST-001',available:3,snapshot_date:'2026-10-30'}],pipeline:[],skuMappings:{'US|TEST-001':'TEST-SPU'}};
test('history clear waits for explicit confirmation; cancel/Escape preserve data; confirmed clear persists',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'stockpilot-clear-ui-'));let server;try{
 server=await createApp(resolve('dist'),{dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url);await page.getByLabel('访问口令',{exact:true}).fill((await readFile(join(dir,'access-code.txt'),'utf8')).trim());await page.getByRole('button',{name:'进入工作区'}).click();await page.locator('#json').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await expect(page.locator('#notice')).toContainText('已更新');
 const original=await readFile(join(dir,'US.json'));let requests=0;page.on('request',r=>{if(r.url().endsWith('/api/workspace/US/clear'))requests++;});
 await page.getByRole('button',{name:'清除历史记录',exact:true}).click();await expect(page.getByRole('heading',{name:'清除美国工作区历史记录'})).toBeVisible();expect(requests).toBe(0);await page.getByRole('button',{name:'取消',exact:true}).click();expect(requests).toBe(0);expect((await readFile(join(dir,'US.json'))).equals(original)).toBe(true);
 await page.getByRole('button',{name:'清除历史记录',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('.clear-history-dialog')).toHaveCount(0);expect(requests).toBe(0);
 await page.getByRole('button',{name:'清除历史记录',exact:true}).click();await page.getByRole('button',{name:'确认清除',exact:true}).click();await expect(page.locator('.clear-history-dialog')).toHaveCount(0);await expect(page.getByText('第一份补货计划，从数据开始')).toBeVisible();expect(requests).toBe(1);
 const saved=JSON.parse(await readFile(join(dir,'US.json'),'utf8'));expect(saved.data.sales).toEqual([]);expect(saved.data.skuMappings).toEqual({});await page.reload();await expect(page.getByText('第一份补货计划，从数据开始')).toBeVisible();
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
test('local-browser mode also cancels safely and clears only after confirmation',async({page})=>{
 await page.goto('/us.html');await page.locator('#json').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await expect(page.locator('details.product')).toHaveCount(1);
 await page.getByRole('button',{name:'清除历史记录',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('details.product')).toHaveCount(1);
 await page.getByRole('button',{name:'清除历史记录',exact:true}).click();await page.getByRole('button',{name:'确认清除',exact:true}).click();await expect(page.getByText('第一份补货计划，从数据开始')).toBeVisible();
});
