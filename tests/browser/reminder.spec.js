import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createApp} from '../../scripts/serve.mjs';import {dateAt,dateNumber} from '../../src/engine.js';
test('reminder center shows risks, remembers shared reads, saves settings and deduplicates granted browser notifications',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'stockpilot-agent-browser-'));let server;
 try{
  server=await createApp(resolve('dist'),{dataDir:dir,agentOptions:{now:()=>new Date('2026-10-30T01:30:00Z')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await page.addInitScript(()=>{window.__notices=[];window.Notification=class {static permission='granted';static async requestPermission(){return 'granted';}constructor(title,options){window.__notices.push({title,body:options.body});}close(){}};});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('访问口令',{exact:true}).fill((await readFile(join(dir,'access-code.txt'),'utf8')).trim());await page.getByRole('button',{name:'进入工作区'}).click();
  const asOf='2026-10-30',data={asOf,sales:Array.from({length:30},(_,n)=>({market:'US',sku:'001',product:'P',date:dateAt(dateNumber(asOf)-n),units:2,in_stock:true})),inventory:[{market:'US',sku:'001',product:'P',available:0,snapshot_date:asOf}],pipeline:[],overrides:{'US|P':'B'}};
  await page.locator('#json').setInputFiles({name:'real-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(page.locator('#notice')).toContainText('已更新');
  await page.getByRole('button',{name:/^补货提醒/}).click();await page.getByRole('button',{name:'立即巡检',exact:true}).click();
  await expect(page.locator('.agent-alert.urgent')).toHaveCount(3);await expect(page.locator('.agent-dialog')).toContainText('001');
  expect(await page.evaluate(()=>window.__notices.length)).toBe(0);
  await page.getByRole('button',{name:'开启本浏览器通知',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__notices.length)).toBe(1);
  await page.getByRole('button',{name:'立即巡检',exact:true}).click();expect(await page.evaluate(()=>window.__notices.length)).toBe(1);
  await page.getByRole('button',{name:'标记已读',exact:true}).first().click();await expect(page.locator('[data-ack]:disabled')).toHaveCount(1);
  await page.locator('.agent-settings summary').click();await page.locator('[name="dailyTime"]').fill('10:00');await page.getByRole('button',{name:'保存巡检设置',exact:true}).click();await expect(page.locator('#agent-error')).toContainText('设置已保存');
  await page.locator('#agent-close').click();await page.reload();await page.getByRole('button',{name:/^补货提醒/}).click();await expect(page.locator('[data-ack]:disabled')).toHaveCount(1);await page.locator('.agent-settings summary').click();await expect(page.locator('[name="dailyTime"]')).toHaveValue('10:00');expect(await page.evaluate(()=>window.__notices.length)).toBe(0);
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
