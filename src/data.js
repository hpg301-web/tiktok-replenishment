import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import { dateAt, dateNumber } from './engine.js';
export function emptyData(asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date())) {
  return { asOf, sales: [], inventory: [], pipeline: [], overrides: {}, routes: {}, productSignals: {} };
}
export function demoData(market, asOf) {
  const d = emptyData(asOf), now = dateNumber(asOf);
  for (const [sku, product, color, size, stock, units] of [['001','Cloud 无钢圈文胸','黑色','M',36,4],['002','Cloud 无钢圈文胸','黑色','L',180,3],['003','Coast 连体泳衣','海蓝','M',240,1]]) {
    d.inventory.push({ market, sku, product, color, size, available:stock, snapshot_date:asOf, warehouse:'TikTok专用仓' });
    for (let n=29;n>=0;n--) d.sales.push({ market, sku, product, color, size, date:dateAt(now-n), units, in_stock:true });
  }
  d.pipeline.push({ market, sku:'001', qty:30, shipment_id:'DEMO-001', eta:dateAt(now+12), status:'in_transit' });
  return d;
}
export async function readTable(file, kind) {
  let rows;
  if (/\.xlsx$/i.test(file.name)) {
    const sheet = await readSheet(file); // First worksheet; template specifies one sheet per file.
    const header = sheet.shift()?.map(String) || [];
    rows = sheet.filter(row=>row.some(v=>v!==null)).map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i]])));
  } else if (/\.csv$/i.test(file.name)) {
    const result = Papa.parse(await file.text(), { header:true, skipEmptyLines:'greedy', transformHeader:h=>h.replace(/^\uFEFF/,'').trim() });
    if (result.errors.length) throw Error('CSV 解析失败：'+result.errors[0].message);
    rows = result.data;
  } else throw Error('请使用 CSV 或 XLSX 文件');
  if (!rows.length) throw Error('文件没有数据行');
  const required = { sales:['market','sku','date','units'], inventory:['market','sku','available','snapshot_date'], pipeline:['market','sku','qty','shipment_id','eta'] }[kind];
  if (!required.every(k=>Object.hasOwn(rows[0],k))) throw Error('缺少列：'+required.join(', '));
  return rows.map(row=>{
    const r = {...row};
    // XLSX identifiers must be stored as text; numeric cells cannot recover leading zeros.
    if (typeof r.sku !== 'string') throw Error('SKU 单元格必须保存为文本，避免丢失前导零');
    for (const key of ['units','available','qty']) if (Object.hasOwn(r,key)) {
      if (r[key] === '' || r[key] == null) throw Error(key+' 不能为空');
      r[key] = Number(r[key]);
    }
    for (const key of ['date','snapshot_date','eta']) if (r[key] instanceof Date) r[key] = r[key].toISOString().slice(0,10);
    if (r.in_stock === '' || r.in_stock == null) delete r.in_stock;
    else if (r.in_stock === true || r.in_stock === 'true') r.in_stock = true;
    else if (r.in_stock === false || r.in_stock === 'false') r.in_stock = false;
    else throw Error('in_stock 只接受 true / false');
    return r;
  });
}
export function csv(rows) {
  // Neutralize spreadsheet formulas in user-supplied labels.
  return '\uFEFF' + Papa.unparse(rows, { escapeFormulae:true });
}
