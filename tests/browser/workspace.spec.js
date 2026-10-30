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
