import { openSpu } from './helpers.mjs';
import { test, expect } from '@playwright/test';
test('demo, override, persistence, market isolation and export', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'美国补货工作台'})).toBeVisible();
  await page.getByRole('button',{name:'载入演示数据'}).click();
  await expect(page.getByText('演示数据 · 不用于采购')).toBeVisible();
  await openSpu(page);await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
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
  await openSpu(page);await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
  await page.locator('[data-kind="inventory"]').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('market,sku,available,snapshot_date\nDE,999,20,2026-10-30\n')});
  await expect(page.getByRole('alert')).toContainText('其他市场');
  await openSpu(page);await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
});
test('mobile layout has no viewport overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/de.html');await page.getByRole('button',{name:'载入演示数据'}).click();
  await openSpu(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('XLSX import parses text SKU and blank sales safely',async({page})=>{
  await page.goto('/us.html');
  await page.locator('[data-kind="inventory"]').setInputFiles('tests/fixtures/inventory.xlsx');
  await openSpu(page);await expect(page.locator('b').filter({hasText:/^0007$/})).toBeVisible();
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
  await page.getByRole('button',{name:'导入当前市场',exact:true}).click();await openSpu(page);await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();
  await page.locator('[data-kind="inventory"]').setInputFiles({name:'库存20261030.csv',mimeType:'text/csv',buffer:Buffer.from('SKU,仓库,可用量,SPU,可用锁定量,实际总量\n001,鲸仓 -美东仓库,10,P001,2,12\n')});
  await expect(page.locator('#apply-import')).toBeDisabled();
  await page.getByRole('checkbox',{name:/确认该日期为库存快照日期/}).check();await expect(page.locator('#apply-import')).toBeEnabled();
  await page.locator('#apply-import').click();await expect(page.locator('details.product > summary h3').filter({hasText:/^P001$/})).toBeVisible();
  await page.reload();await expect(page.getByText('TikTok 订单 · 接受1条 / 排除1条')).toBeVisible();
});
test('SPU cards start collapsed, expand only their own SKUs and retain expansion after strategy changes',async({page})=>{
 await page.goto('/us.html');await page.getByRole('button',{name:'载入演示数据'}).click();
 const groups=page.locator('details.product[data-spu]');await expect(groups).toHaveCount(2);
 await expect(groups.first().locator('table')).toBeHidden();await expect(groups.nth(1).locator('table')).toBeHidden();
 await openSpu(page,0);await expect(page.locator('b').filter({hasText:/^001$/})).toBeVisible();await expect(page.locator('b').filter({hasText:/^002$/})).toBeVisible();await expect(page.locator('b').filter({hasText:/^003$/})).toBeHidden();
 await groups.first().locator('[data-product]').selectOption('C');await expect(groups.first().locator('table')).toBeVisible();await expect(groups.nth(1).locator('table')).toBeHidden();
 await groups.first().locator(':scope > summary').press('Enter');await expect(groups.first().locator('table')).toBeHidden();
});
test('SKU coding automatically shows SPU card and parsed color/size for already imported records',async({page})=>{
 await page.goto('/us.html');const asOf='2026-10-30';
 const rows=['A007F1300_34C','A007F1301_34D'];const data={asOf,sales:rows.map(sku=>({market:'US',sku,date:asOf,units:1})),inventory:rows.map(sku=>({market:'US',sku,available:10,snapshot_date:asOf})),pipeline:[]};
 await page.locator('#json').setInputFiles({name:'coding-rule-example.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(page.locator('details.product')).toHaveCount(1);await expect(page.locator('details.product > summary h3')).toHaveText('A007F13');
 await openSpu(page);await expect(page.locator('tbody tr').first()).toContainText('颜色 00');await expect(page.locator('tbody tr').first()).toContainText('尺码 34C');
 await page.reload();await expect(page.locator('details.product > summary h3')).toHaveText('A007F13');await page.getByRole('button',{name:'手动归类SKU',exact:true}).click();await page.locator('#classification-filter').selectOption('rule');await expect(page.locator('.classification-row')).toHaveCount(2);await expect(page.locator('.classification-row').first()).toContainText('编码识别');
 await page.locator('#classification-close').click();
});
