import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/browser';
import { inspectTable, normalizeImport } from './importer.js';
import { dateAt, dateNumber } from './engine.js';
export function emptyData(asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date())) {
  return { asOf, sales: [], inventory: [], pipeline: [], overrides: {}, routes: {}, productSignals: {}, skuMappings: {} };
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
export async function parseImportFile(file, kind) {
  let sheets;
  if (/\.xlsx$/i.test(file.name)) sheets = await readXlsxFile(file);
  else if (/\.csv$/i.test(file.name)) {
    const bytes=new Uint8Array(await file.arrayBuffer());
    let text;
    if(bytes[0]===255 && bytes[1]===254)text=new TextDecoder('utf-16le').decode(bytes);
    else if(bytes[0]===254 && bytes[1]===255)text=new TextDecoder('utf-16be').decode(bytes);
    else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}}
    const parsed=Papa.parse(text.replace(/^\uFEFF/,''),{skipEmptyLines:false});
    if(parsed.errors.length)throw Error('CSV解析失败：'+parsed.errors[0].message);
    sheets=[{name:'CSV',data:parsed.data}];
  } else throw Error('请使用 CSV 或 XLSX 文件');
  const candidates=[];
  for(const sheet of sheets){try{candidates.push(inspectTable(sheet.data,kind,file.name,sheet.name));}catch{}}
  if(!candidates.length)throw Error('未找到可识别的对应工作表，请检查是否上传到正确的数据栏。');
  return candidates;
}
export async function readTable(file, kind, options={}) {
  const candidates=await parseImportFile(file,kind);
  const info=candidates[0];
  const {rows,report}=normalizeImport(info,{...options,market:options.market||'US',asOf:options.asOf||emptyData().asOf});
  if(report.errors.length)throw Error(report.errors.map(e=>`第${e.row}行：${e.reason}`).join('；'));
  return rows;
}
export function csv(rows) {
  // Neutralize spreadsheet formulas in user-supplied labels.
  return '\uFEFF' + Papa.unparse(rows, { escapeFormulae:true });
}
