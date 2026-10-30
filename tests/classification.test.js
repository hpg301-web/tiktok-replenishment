import test from 'node:test';import assert from 'node:assert/strict';
import {plan,validate,applyManualMappings,dateAt,dateNumber} from '../src/engine.js';
import {assessWorkspace} from '../scripts/reminder-agent.mjs';
function fixture(){const asOf='2026-10-30';return {asOf,sales:['001-M','001-L'].flatMap(sku=>Array.from({length:30},(_,n)=>({market:'US',sku,date:dateAt(dateNumber(asOf)-n),units:2,in_stock:true}))),inventory:[{market:'US',sku:'001-M',available:0,snapshot_date:asOf},{market:'US',sku:'001-L',available:1000,snapshot_date:asOf}],pipeline:[],skuMappings:{'US|001-M':'SPU-001','US|001-L':'SPU-001'},overrides:{'US|SPU-001':'B'}};}
test('manual classification groups products but keeps each SKU stock, demand and shortage independent',()=>{
 const data=fixture(),original=JSON.stringify(data),result=plan(data,'US');
 assert.equal(result.products.length,1);assert.equal(result.products[0].product,'SPU-001');assert.equal(result.items.length,2);
 const m=result.items.find(i=>i.sku==='001-M'),l=result.items.find(i=>i.sku==='001-L');assert.equal(m.available,0);assert.equal(l.available,1000);assert.equal(m.demand,2);assert.equal(l.demand,2);assert.ok(m.sea>0);assert.equal(l.sea,0);assert.equal(m.firstStockout,data.asOf);assert.equal(m.productSource,'manual');assert.equal(JSON.stringify(data),original);
});
test('manual assignment overrides conflicting source products and removal restores original source behavior',()=>{
 const data=fixture();data.sales.forEach(r=>r.product='ORIGINAL-SALES');data.inventory.forEach(r=>r.product='ORIGINAL-ERP');assert.equal(plan(data,'US').products[0].product,'SPU-001');assert.equal(data.sales[0].product,'ORIGINAL-SALES');
 const noManual={...data,skuMappings:{}};assert.throws(()=>plan(noManual,'US'),/多个产品/);
 const simple=fixture();simple.skuMappings={};assert.equal(plan(simple,'US').items[0].productSource,'unknown');
 simple.inventory[0].product='AUTO-SPU';assert.equal(plan(simple,'US').items.find(i=>i.sku==='001-M').productSource,'source');
});
test('classification keys are exact and market-specific, leading zeros survive and invalid assignments rejected',()=>{
 const data=fixture();data.skuMappings={'DE|001-M':'DE-SPU','US|1-M':'WRONG'};const result=plan(data,'US');assert.equal(result.items.find(i=>i.sku==='001-M').product,'001-M');
 data.skuMappings={'US|001-M':'000123'};assert.equal(plan(data,'US').items.find(i=>i.sku==='001-M').product,'000123');
 for(const map of [null,[],{'001-M':'P'},{'US|001-M':''},{'US|001-M':123},{'US|001-M':' P '},{'US|001-M':'P\nX'}])assert.throws(()=>validate({...data,skuMappings:map},'US'));
});
test('JSON roundtrip retains manual rules and reminders use the assigned SPU',()=>{
 const data=JSON.parse(JSON.stringify(fixture()));assert.equal(applyManualMappings(data,'US').sales[0].product,'SPU-001');
 const alerts=assessWorkspace({revision:1,isDemo:false,data},'US',{today:data.asOf,lookAheadDays:7});assert.ok(alerts.some(a=>a.sku==='001-M'&&a.spu==='SPU-001'));assert.ok(!alerts.some(a=>a.spu==='001-M'));assert.equal(data.sales[0].product,undefined);
});
