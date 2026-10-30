import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createApp} from '../../scripts/serve.mjs';
test('update UI requires confirmation and reports an installation failure without changing the workspace',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'stockpilot-update-ui-'));let server,installs=0;
 const updater={current:{version:'0.2.0',buildId:'old'},supported:true,check:async()=>({available:true,supported:true,currentVersion:'0.2.0',version:'0.3.0',buildId:'new',notes:'Test release'}),install:async input=>{expect(input).toEqual({confirmed:true,buildId:'new'});installs++;return {accepted:true};},status:async()=>installs?{phase:'failed',message:'模拟启动失败：原版继续运行'}:{phase:'idle'}};
 try{
  server=await createApp(resolve('dist'),{dataDir:dir,updaterFactory:()=>updater});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('访问口令',{exact:true}).fill((await readFile(join(dir,'access-code.txt'),'utf8')).trim());await page.getByRole('button',{name:'进入工作区'}).click();
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.locator('#update-status')).toHaveText('发现新版本');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'备份并更新',exact:true}).click();expect(installs).toBe(0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'备份并更新',exact:true}).click();
  await expect(page.locator('#update-status')).toContainText('模拟启动失败');expect(installs).toBe(1);
  await page.locator('#close-update').click();await expect(page.getByText('第一份补货计划，从数据开始')).toBeVisible();
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
