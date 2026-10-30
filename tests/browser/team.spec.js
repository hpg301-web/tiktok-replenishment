import { openSpu } from './helpers.mjs';
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../scripts/serve.mjs';
let server,dir,url,code;
test.beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'stockpilot-browser-'));server=await createApp(resolve('dist'),{dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;code=(await readFile(join(dir,'access-code.txt'),'utf8')).trim();});
test.afterAll(async()=>{if(server)await new Promise(r=>server.close(r));if(dir)await rm(dir,{recursive:true,force:true});});
test('two colleagues share data; conflicting edits are preserved; logout blocks data',async({browser})=>{
  const a=await browser.newContext(),b=await browser.newContext();
  try{
    const first=await a.newPage(),second=await b.newPage();
    for(const p of [first,second]){await p.goto(url);await p.getByLabel('访问口令',{exact:true}).fill(code);await p.getByRole('button',{name:'进入工作区'}).click();await expect(p.getByRole('button',{name:'载入最新数据'})).toBeVisible();}
    await first.getByRole('button',{name:'载入演示数据'}).click();await expect(first.locator('#notice')).toContainText('保存到团队主机');
    await second.getByRole('button',{name:'载入最新数据'}).click();await openSpu(second);await expect(second.locator('b').filter({hasText:/^001$/})).toBeVisible();
    await openSpu(first);await first.locator('[data-product]').first().selectOption('B');await expect(first.locator('#notice')).toContainText('保存到团队主机');
    await second.locator('[data-product]').first().selectOption('C');await expect(second.getByRole('alert')).toContainText('同事已更新');
    await second.getByRole('button',{name:'载入最新数据'}).click();await expect(second.locator('[data-product]').first()).toHaveValue('B');
    await second.getByRole('link',{name:'DE 德国工作区'}).click();await expect(second.getByText('第一份补货计划，从数据开始')).toBeVisible();
    await second.getByRole('button',{name:'退出登录'}).click();await expect(second.getByRole('heading',{name:'登录团队工作区'})).toBeVisible();
    await second.reload();await expect(second.getByRole('heading',{name:'登录团队工作区'})).toBeVisible();
  }finally{await a.close();await b.close();}
});
