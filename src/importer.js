import { dateNumber } from './engine.js';
const norm=s=>String(s??'').trim().toLowerCase().replace(/[\s_\-()（）/]/g,'');
const aliases={
  sku:['sku','seller sku','卖家sku','商家编码','商家sku','商品编码'],
  country:['market','country','国家/地区','国家','国家地区','收货国家'],
  warehouse:['warehouse','仓库','warehouse name','仓库名称'],
  product:['product','spu','款号'],
  color:['color','颜色'],size:['size','尺码'],date:['date','销售日期'],units:['units','销量'],
  available:['available','可用量','可用库存'],snapshot_date:['snapshot_date','快照日期','库存日期'],
  qty:['qty','剩余数量','剩余未入库数量'],eta:['eta','可售日期','预计上架日期'],shipment_id:['shipment_id','备货单号','发货单号'],
  orderId:['order id','订单编号','订单id'],skuId:['sku id'],packageId:['package id','包裹编号'],
  status:['order status','订单状态'],substatus:['order substatus','订单子状态'],cancel:['cancelation/return type','退货取消类型'],
  shipped:['shipped time','发货时间','出库时间'],paid:['paid time','付款时间','支付时间'],quantity:['quantity','数量','购买数量'],returned:['sku quantity of return','退货件数'],variation:['variation','规格'],
  shop:['店铺','shop'],fnsku:['fnsku'],msku:['msku'],attributes:['属性','attributes'],title:['品名','product name'],
  destination:['收货仓库','目的仓','目标仓库'],sent:['备货数量','发货数量'],received:['收货数量','已收货数量'],docstatus:['单据状态','备货状态'],mode:['运输方式','mode'],arrival:['预计到货时间','预计到港时间','预计到货日期'],actualArrival:['实际到货时间'],dispatch:['实际发货时间'],
};
const formats={standard:{sales:['sku','country','date','units'],inventory:['sku','country','available','snapshot_date'],pipeline:['sku','country','qty','shipment_id','eta']},tiktok:{sales:['sku','orderId','status','quantity','shipped','paid']},lingxing:{inventory:['sku','warehouse','available'],pipeline:['sku','shipment_id','destination','sent','received','docstatus']}};
export function inspectTable(matrix,kind,fileName='',sheetName=''){
  let best;
  for(let h=0;h<Math.min(matrix.length,30);h++){
    const cols=matrix[h].map(norm),fields={};
    for(const [field,names] of Object.entries(aliases)){
      // SKU ID is a platform ID, never a seller SKU fallback.
      const indexes=cols.map((c,i)=>names.some(n=>norm(n)===c)?i:-1).filter(i=>i>=0);
      if(indexes.length===1)fields[field]=indexes[0];
    }
    for(const [source,types] of Object.entries(formats)){
      const required=types[kind];if(!required||!required.every(f=>fields[f]!==undefined))continue;
      if(source==='standard' && !['market'].some(n=>cols.includes(norm(n))))continue;
      const score=required.length+(source==='standard'?10:0);
      if(!best||score>best.score)best={source,kind,score,fields,header:h,headers:matrix[h].map(v=>String(v??'').trim()),matrix,fileName,sheetName};
    }
  }
  if(!best)throw Error('未识别到对应表格：请上传 TikTok 订单、领星仓库库存/海外仓备货单，或标准模板。');
  const get=(row,key)=>best.fields[key]===undefined?'':row[best.fields[key]];
  best.warehouses=[...new Set(matrix.slice(best.header+1).map(r=>clean(get(r,kind==='pipeline'?'destination':'warehouse'))).filter(Boolean))];
  const countryValues=matrix.slice(best.header+1).map(r=>inferMarket(get(r,'country'))).filter(Boolean);
  best.markets=[...new Set(countryValues)];
  best.suggestedDate=fileDate(fileName);
  best.mapping=Object.entries(best.fields).filter(([key])=>({sales:['sku','quantity','status','shipped','paid','country','date','units','variation'],inventory:['sku','available','warehouse','country','product','attributes','snapshot_date'],pipeline:['sku','sent','received','shipment_id','destination','docstatus','mode','arrival','eta']}[kind].includes(key))).map(([field,index])=>({field,column:best.headers[index]}));
  return best;
}
export const clean=v=>String(v??'').trim();
export function inferMarket(value){const s=clean(value).toLowerCase();if(/^(us|usa|united states(?: of america)?|美国|美國)$/.test(s))return'US';if(/^(de|deu|germany|deutschland|德国|德國)$/.test(s))return'DE';return null;}
function warehouseMarket(value){const s=clean(value);if(/美东|美西|美国|美國|\bUS\b|\bUSA\b/i.test(s))return'US';if(/德国|德國|\bDE\b|germany/i.test(s))return'DE';return null;}
export const warehouseKey=value=>clean(value).replace(/[\s\-－—_]/g,'').replace(/仓库$/,'仓');
export function fileDate(name){const m=/(20\d{2})[-_年]?(\d{2})[-_月]?(\d{2})/.exec(name);if(!m)return'';const d=`${m[1]}-${m[2]}-${m[3]}`;try{dateNumber(d);return d;}catch{return'';}}
export function parseDate(value,order='MDY'){
  if(value instanceof Date)return value.toISOString().slice(0,10);
  const s=clean(value);if(!s)return'';
  let m=/^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|\b)/.exec(s),y,month,day;
  if(m){[,y,month,day]=m;}
  else if((m=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})(?:\b|\s)/.exec(s))){y=m[3];[month,day]=order==='DMY'?[m[2],m[1]]:[m[1],m[2]];}
  else throw Error('无法识别日期格式');
  const d=`${y}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;dateNumber(d);return d;
}
function quantity(v,label){if(clean(v)==='')throw Error(label+'为空，不能代零');const n=Number(clean(v).replace(/,/g,''));if(!Number.isSafeInteger(n)||n<0)throw Error(label+'必须为非负整数');return n;}
function sku(v){if(typeof v!=='string'||!v.trim())throw Error('SKU必须为非空文本，数值单元格不能恢复前导零');return v.trim();}
const closed=/^(已取消|已作废|已完成|已收货|已入库|cancelled|canceled|completed|received)$/i;
const outbound=/^(已发货|已完成|已送达|shipped|completed|delivered|in transit)$/i;
const cancelled=/^(已取消|未付款|待付款|cancelled|canceled|unpaid|awaiting payment)$/i;
export function normalizeImport(info,options={}){
  const {market,asOf}=options;dateNumber(asOf);
  const {source,kind,fields,matrix,header}=info;
  const get=(r,k)=>fields[k]===undefined?'':r[fields[k]];
  const rows=[],excluded=[],errors=[],warnings=new Set(),seen=new Map(),daily=new Map();
  const report={source:source==='tiktok'?'TikTok 订单':source==='lingxing'?'领星 ERP':'标准模板',fileName:info.fileName,sheet:info.sheetName,kind,market,importedAt:new Date().toISOString(),mapping:info.mapping,total:0,accepted:0,excluded,errors,warnings:[],warehouses:options.warehouses||[],snapshotDate:kind==='inventory'?options.snapshotDate||'':undefined,etaMeaning:options.etaMeaning||'unknown'};
  const selected=new Set((options.warehouses||[]).map(warehouseKey));
  const genericInventory=new Set(kind==='inventory'&&source==='lingxing'?matrix.slice(header+1).filter(r=>!clean(get(r,'shop'))&&!clean(get(r,'fnsku'))&&!clean(get(r,'msku'))).map(r=>JSON.stringify([warehouseKey(get(r,'warehouse')),clean(get(r,'sku'))])):[]);
  if(source==='lingxing' && !options.scopeConfirmed)errors.push({row:0,reason:'请确认所选仓库库存/在途属于 TikTok 专用范围'});
  if(source==='lingxing' && !selected.size)errors.push({row:0,reason:'请选择至少一个目标仓库'});
  if(source==='lingxing' && kind==='inventory' && !options.snapshotConfirmed)errors.push({row:0,reason:'请确认库存快照日期及可用量口径'});
  for(let i=header+1;i<matrix.length;i++){
    const r=matrix[i];if(!r.some(v=>clean(v)))continue;report.total++;
    const skip=reason=>excluded.push({row:i+1,reason});
    try{
      if(source==='standard'){
        const out={market:clean(get(r,'country')),sku:sku(get(r,'sku'))};
        if(out.market!==market)throw Error('标准模板包含其他市场或无效市场');
        for(const k of ['product','color','size'])if(clean(get(r,k)))out[k]=clean(get(r,k));
        if(kind==='sales'){out.date=parseDate(get(r,'date'));out.units=quantity(get(r,'units'),'销量');const index=info.headers.findIndex(h=>norm(h)==='instock');const stock=index>=0?r[index]:'';if(clean(stock)){if(![true,false,'true','false'].includes(stock))throw Error('in_stock只接受true/false');out.in_stock=stock===true||stock==='true';}}
        if(kind==='inventory'){out.available=quantity(get(r,'available'),'可用量');out.snapshot_date=parseDate(get(r,'snapshot_date'));if(clean(get(r,'warehouse')))out.warehouse=clean(get(r,'warehouse'));}
        if(kind==='pipeline'){out.qty=quantity(get(r,'qty'),'剩余数量');out.shipment_id=clean(get(r,'shipment_id'));out.eta=parseDate(get(r,'eta'));if(clean(get(r,'mode')))out.mode=clean(get(r,'mode'));const idx=info.headers.findIndex(h=>norm(h)==='status');if(idx>=0)out.status=clean(r[idx]);}
        rows.push(out);report.accepted++;continue;
      }
      const warehouse=clean(get(r,kind==='pipeline'?'destination':'warehouse'));
      const country=clean(get(r,'country'));
      let inferred=inferMarket(country)||warehouseMarket(warehouse);
      if(country&&!inferMarket(country)){skip('非美国/德国国家记录');continue;}
      if(inferred&&inferred!==market){skip('其他国家记录');continue;}
      if(!inferred&&!options.marketConfirmed)throw Error('缺少可识别国家，请确认此文件属于当前市场');
      inferred=market;
      if(source==='lingxing'&&!selected.has(warehouseKey(warehouse))){skip('未选择的仓库');continue;}
      const id=sku(get(r,'sku'));
      const out={market:inferred,sku:id,source_row:i+1};
      if(kind==='sales'){
        const status=clean(get(r,'status')),cancellation=clean(get(r,'cancel'));
        if(cancelled.test(status)||/^cancel$/i.test(cancellation)){skip('取消或未付款订单');continue;}
        if(!outbound.test(status)){skip('未实际出库状态（含待发货/待揽收）');continue;}
        if(!clean(get(r,'paid'))||!clean(get(r,'shipped'))){skip('缺少付款/实际发货时间，无法确认有效出库');continue;}
        const date=parseDate(get(r,'shipped'),options.dateOrder||'MDY');
        if(date>asOf){skip('分析日之后的出库记录');continue;}
        if(dateNumber(asOf)-dateNumber(date)>59){skip('超过60天观察窗口');continue;}
        const units=quantity(get(r,'quantity'),'出库件数');
        const order=clean(get(r,'orderId'));if(!order)throw Error('订单编号为空，无法去重');
        const line=JSON.stringify([order,clean(get(r,'skuId'))||id,clean(get(r,'packageId'))]);
        const signature=JSON.stringify([units,date,status]);
        if(seen.has(line)){if(seen.get(line)!==signature)throw Error('同订单/SKU/包裹出现冲突行，不能重复计量');skip('重复订单行');continue;}seen.set(line,signature);
        if(clean(get(r,'returned'))&&quantity(get(r,'returned'),'退货件数')>0)warnings.add('存在退货：出库销量按原发出件数统计，未将退货自动加回库存');
        const variation=clean(get(r,'variation')).split(/,\s*/);
        if(variation.length>1){out.size=variation.pop();out.color=variation.join(', ');}
        const key=JSON.stringify([date,id]);
        if(daily.has(key))daily.get(key).units+=units;else daily.set(key,{...out,date,units});
        report.accepted++;continue;
      }
      if(kind==='inventory'){
        // FNSKU/MSKU FBA rows are allocation rows, not the generic TikTok stock pool.
        if(clean(get(r,'fnsku'))||/[-_]FBA(?:$|[-_])/i.test(clean(get(r,'msku')))){skip('FBA/FNSKU库存范围，避免混入或重复计算');continue;}
        out.available=quantity(get(r,'available'),'可用量');
        if(clean(get(r,'shop')) && out.available===0 && genericInventory.has(JSON.stringify([warehouseKey(warehouse),id]))) {skip('零可用量店铺分配行，已存在同仓SKU通用库存');continue;}
        out.warehouse=warehouseKey(warehouse);out.snapshot_date=options.snapshotConfirmed?parseDate(options.snapshotDate):'';
        const product=get(r,'product');if(clean(product)&&typeof product==='string')out.product=product.trim();
        const attr=clean(get(r,'attributes'));
        out.size=/(?:^|,)\s*(?:Size|尺码)\\([^,]+)/i.exec(attr)?.[1]?.trim()||'';
        out.color=/(?:^|,)\s*(?:Color|颜色)\\([^,]+)/i.exec(attr)?.[1]?.trim()||'';
        const key=JSON.stringify([out.warehouse,id]);if(seen.has(key))throw Error('同仓库/SKU存在重复库存行，请核实后再导入');seen.set(key,true);
        rows.push(out);report.accepted++;continue;
      }
      const status=clean(get(r,'docstatus'));
      if(closed.test(status)){skip('已完成/已入库/已取消备货单');continue;}
      if(!/^(待收货|运输中|部分收货|已发货|in transit|shipped|partially received)$/i.test(status)){skip('未确认已发运的备货状态');continue;}
      const sent=quantity(get(r,'sent'),'备货数量'),received=quantity(get(r,'received'),'收货数量');
      if(received>sent)throw Error('收货数量大于备货数量，须核实');
      if(sent===received){skip('无剩余在途数量');continue;}
      out.qty=sent-received;out.shipment_id=clean(get(r,'shipment_id'));if(!out.shipment_id)throw Error('备货单号为空');
      const key=JSON.stringify([out.shipment_id,id]);if(seen.has(key))throw Error('同备货单/SKU重复，不能重复入账');seen.set(key,true);
      out.status='in_transit';out.mode=clean(get(r,'mode'));out.destination=warehouseKey(warehouse);
      const rawEta=clean(get(r,'eta'))||clean(get(r,'arrival'));
      out.source_eta=rawEta;out.eta='';
      if(clean(get(r,'eta')))out.eta=parseDate(get(r,'eta'));
      else if(rawEta && options.etaMeaning && options.etaMeaning!=='unknown'){
        const base=parseDate(get(r,'arrival'));let extra=0;
        if(options.etaMeaning==='port')extra=(options.route?.customs??5)+(options.route?.shelf??5);
        else if(options.etaMeaning==='customs')extra=options.route?.shelf??5;
        else if(options.etaMeaning!=='sellable')throw Error('未知ETA口径');
        out.eta=new Date((dateNumber(base)+extra)*86400000).toISOString().slice(0,10);
      }
      if(!out.eta)warnings.add('在途预计到货日期口径未确认：保留数量，但不抵扣可用供给');
      else if(out.eta<asOf)warnings.add('存在已逾期可售ETA：保留记录，但不抵扣可用供给');
      if(clean(get(r,'actualArrival')))warnings.add('存在实际到货日期，签收不等于已上架，需核实剩余在途');
      rows.push(out);report.accepted++;
    }catch(e){errors.push({row:i+1,reason:e.message});}
  }
  if(kind==='sales'&&source==='tiktok'){rows.push(...daily.values());warnings.add('按实际发货日统计有效出库件数；订单表没有历史可售证据，不自动标记为有货');}
  if(kind==='inventory'&&source==='lingxing')warnings.add('使用可用量，不再次扣减锁定量；不读取实际总量、待到货量或调拨在途作为可用库存');
  if(!rows.length)errors.push({row:0,reason:'筛选后没有可导入的记录'});
  report.output=rows.length;report.units=rows.reduce((sum,r)=>sum+(r[kind==='sales'?'units':kind==='inventory'?'available':'qty']||0),0);report.eligibleUnits=kind==='pipeline'?rows.filter(r=>r.eta&&r.eta>=asOf).reduce((sum,r)=>sum+r.qty,0):null;report.warnings=[...warnings];
  return {rows,report};
}
