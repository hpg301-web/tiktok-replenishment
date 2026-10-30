import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTable,normalizeImport,parseDate,fileDate,warehouseKey} from '../src/importer.js';
const options={market:'US',asOf:'2026-10-30',warehouses:['鲸仓 -美东仓库'],scopeConfirmed:true,marketConfirmed:true,snapshotConfirmed:true,snapshotDate:'2026-10-30'};
function run(matrix,kind,extra={}){return normalizeImport(inspectTable(matrix,kind,'export-20261030.xlsx','data'),{...options,...extra});}
test('TikTok uses seller SKU, outbound quantity and shipped date; filters pending/unpaid/cancelled and aggregates days',()=>{
 const head=['Order ID','Order Status','SKU ID','Seller SKU','Quantity','Paid Time','Shipped Time','Country','Variation','Recipient','Phone #'];
 const row=(id,status,paid='10/28/2026 8:00 PM',shipped='10/29/2026 8:00 PM')=>[id,status,'PLATFORM-ID','0001',2,paid,shipped,'美国','Black, M','PRIVATE BUYER','PRIVATE PHONE'];
 const {rows,report}=run([head,row('one','已发货'),row('two','已完成'),row('three','待发货'),row('four','已取消'),row('five','已发货',''),row('six','已完成',undefined,'')],'sales');
 assert.equal(report.accepted,2);assert.equal(report.excluded.length,4);assert.equal(rows.length,1);assert.equal(rows[0].sku,'0001');assert.equal(rows[0].units,4);assert.equal(rows[0].date,'2026-10-29');assert.equal(rows[0].color,'Black');assert.ok(!JSON.stringify({rows,report}).includes('PRIVATE'));
});
test('duplicate orders are not counted twice; conflicting duplicates block import',()=>{
 const h=['Order ID','Order Status','Seller SKU','Quantity','Paid Time','Shipped Time','Country'];const r=['same','已发货','001',1,'10/28/2026','10/29/2026','美国'];
 const a=run([h,r,r],'sales');assert.equal(a.rows[0].units,1);assert.equal(a.report.excluded.length,1);
 const copy=[...r];copy[3]=3;assert.match(run([h,r,copy],'sales').report.errors[0].reason,/冲突/);
});
test('inventory ignores FBA allocations, avoids re-subtracting locks, preserves SPU/attributes and rejects generic duplicates',()=>{
 const h=['SKU','仓库','可用量','可用锁定量','实际总量','SPU','属性','店铺','FNSKU','MSKU'];
 const r=['001','鲸仓 -美东仓库',10,2,12,'P','Size\\M,Color\\Black','','',''];
 const fba=['001','鲸仓 -美东仓库',0,0,0,'P','','FBA shop','X001','001-FBA'];
 const allocation=['001','鲸仓 -美东仓库',0,0,0,'P','','shop','',''];
 const a=run([h,r,fba,allocation],'inventory');assert.equal(a.report.errors.length,0);assert.equal(a.report.excluded.length,2);assert.equal(a.rows.length,1);assert.equal(a.rows[0].available,10);assert.equal(a.rows[0].product,'P');assert.equal(a.rows[0].size,'M');assert.equal(a.rows[0].color,'Black');
 assert.match(run([h,r,r],'inventory').report.errors[0].reason,/重复/);
 assert.ok(run([h,r],'inventory',{snapshotConfirmed:false}).report.errors.length);
});
test('missing numeric quantities and numeric SKUs never become valid zero/text',()=>{
 const h=['SKU','仓库','可用量'];
 assert.match(run([h,['001','鲸仓 -美东仓库','']],'inventory').report.errors[0].reason,/为空/);
 assert.match(run([h,[1,'鲸仓 -美东仓库',0]],'inventory').report.errors[0].reason,/文本/);
 assert.equal(run([h,['001','鲸仓 -美东仓库',0]],'inventory').rows[0].available,0);
});
test('pipeline subtracts received once and preserves unknown ETA; selected date semantics add only remaining stages',()=>{
 const h=['sku','备货单号','收货仓库','备货数量','收货数量','单据状态','预计到货时间'];const r=['001','SHIP-1','鲸仓 -美东仓库',50,15,'待收货','2026-10-27'];
 const a=run([h,r],'pipeline');assert.equal(a.rows[0].qty,35);assert.equal(a.rows[0].eta,'');assert.equal(a.rows[0].source_eta,'2026-10-27');
 assert.equal(run([h,r],'pipeline',{etaMeaning:'port',route:{customs:5,shelf:5}}).rows[0].eta,'2026-11-06');
 assert.equal(run([h,r],'pipeline',{etaMeaning:'customs',route:{shelf:5}}).rows[0].eta,'2026-11-01');
 const s=run([h,r],'pipeline',{etaMeaning:'sellable'});assert.equal(s.rows[0].eta,'2026-10-27');assert.ok(s.report.warnings.some(w=>w.includes('逾期')));
 const invalid=[...r];invalid[4]=60;assert.match(run([h,invalid],'pipeline').report.errors[0].reason,/大于/);
});
test('market filtering and warehouse selections are explicit; unidentified country requires confirmation',()=>{
 const h=['SKU','仓库','可用量'];
 const a=run([h,['001','德国仓',2],['002','鲸仓 -美东仓库',3]],'inventory');assert.equal(a.rows.length,1);assert.equal(a.rows[0].sku,'002');assert.equal(a.report.excluded.length,1);
 const b=run([h,['001','未知仓',2]],'inventory',{warehouses:['未知仓'],marketConfirmed:false});assert.ok(b.report.errors.some(e=>e.reason.includes('国家')));
});
test('header detection skips preambles; dates are parsed deterministically, filename only suggests snapshot',()=>{
 const info=inspectTable([['export'],[],['SKU','仓库','可用量'],['001','鲸仓 -美东仓库',1]],'inventory','库存20261030-123.xlsx');assert.equal(info.header,2);assert.equal(info.suggestedDate,'2026-10-30');
 assert.equal(parseDate('10/29/2026 10:00 PM\t'),'2026-10-29');assert.equal(parseDate('29.10.2026','DMY'),'2026-10-29');assert.throws(()=>parseDate('02/30/2026'));assert.equal(fileDate('file-20260230.xlsx'),'');assert.equal(warehouseKey('鲸仓 -美东仓库'),'鲸仓美东仓');
});
