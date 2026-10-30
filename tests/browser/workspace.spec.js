import { test, expect } from '@playwright/test';
test('demo, override, persistence, market isolation and export', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'美国补货工作台'})).toBeVisible();
  await page.getByRole('button',{name:'载入演示数据'}).click();
  await expect(page.getByText('演示数据 · 不用于采购')).toBeVisible();
  await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
  await page.locator('[data-product]').first().selectOption('C');
  await page.reload();await expect(page.locator('[data-product]').first()).toHaveValue('C');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:/导出补货清单/}).click();expect((await download).suggestedFilename()).toContain('-demo.csv');
  await page.getByRole('link',{name:'DE 德国工作区'}).click();await expect(page.getByText('第一份补货计划，从数据开始')).toBeVisible();
  await page.getByRole('link',{name:'US 美国工作区'}).click();await expect(page.locator('[data-product]').first()).toHaveValue('C');
  expect(errors).toEqual([]);
});
test('CSV import keeps SKU text; mixed markets fail atomically',async({page})=>{
  await page.goto('/us.html');
  await page.locator('[data-kind="inventory"]').setInputFiles({name:'stock.csv',mimeType:'text/csv',buffer:Buffer.from('market,sku,available,snapshot_date\nUS,001,20,2026-10-30\n')});
  await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
  await page.locator('[data-kind="inventory"]').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('market,sku,available,snapshot_date\nDE,999,20,2026-10-30\n')});
  await expect(page.getByRole('alert')).toContainText('其他市场');
  await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
});
test('mobile layout has no viewport overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/de.html');await page.getByRole('button',{name:'载入演示数据'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('XLSX import parses text SKU and blank sales safely',async({page})=>{
  await page.goto('/us.html');
  await page.locator('[data-kind="inventory"]').setInputFiles('tests/fixtures/inventory.xlsx');
  await expect(page.locator('b').filter({hasText:/^0007$/})).toBeVisible();
  await expect(page.locator('#notice')).toContainText('已更新');
});
test('JSON restore validates dates and persists transport parameters',async({page})=>{
  await page.goto('/us.html');
  await page.locator('#json').setInputFiles({name:'workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({asOf:'2026-10-30',sales:[],inventory:[],pipeline:[],routes:{US:{sea:40}}}))});
  await page.locator('.settings summary').click();
  await expect(page.locator('[name="sea"]')).toHaveValue('40');
  await page.reload();await expect(page.locator('[name="sea"]')).toHaveValue('40');
});
test('smart importer recognizes original exports, requires snapshot confirmation and shows filtered rows',async({page})=>{
  await page.goto('/us.html');
  await page.locator('[data-kind="sales"]').setInputFiles({name:'TikTok-orders.csv',mimeType:'text/csv',buffer:Buffer.from('Order ID,Order Status,Seller SKU,Quantity,Paid Time,Shipped Time,Country\n1,已发货,001,2,10/28/2026,10/29/2026,美国\n2,待发货,002,1,10/29/2026,,美国\n')});
  await expect(page.locator('.import-dialog')).toBeVisible();await expect(page.locator('#import-preview')).toContainText('源记录 2 · 接受 1 · 排除 1 · 输出 1');
  await page.getByRole('button',{name:'导入当前市场',exact:true}).click();await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
  await page.locator('[data-kind="inventory"]').setInputFiles({name:'库存20261030.csv',mimeType:'text/csv',buffer:Buffer.from('SKU,仓库,可用量,SPU,可用锁定量,实际总量\n001,鲸仓 -美东仓库,10,P001,2,12\n')});
  await expect(page.locator('#apply-import')).toBeDisabled();
  await page.getByRole('checkbox',{name:/确认该日期为库存快照日期/}).check();await expect(page.locator('#apply-import')).toBeEnabled();
  await page.locator('#apply-import').click();await expect(page.getByRole('heading',{name:'P001',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('TikTok 订单 · 接受1条 / 排除1条')).toBeVisible();
});
