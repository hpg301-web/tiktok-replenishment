import test from 'node:test';import assert from 'node:assert/strict';
import {parseSkuCode,applyManualMappings,plan} from '../src/engine.js';
import {assessWorkspace} from '../scripts/reminder-agent.mjs';
function data(){const asOf='2026-10-30';return {asOf,sales:[{market:'US',sku:'A007F1300_34C',date:asOf,units:2},{market:'US',sku:'A007F1301_34D',date:asOf,units:2}],inventory:[{market:'US',sku:'A007F1300_34C',available:0,snapshot_date:asOf},{market:'US',sku:'A007F1301_34D',available:1000,snapshot_date:asOf}],pipeline:[],overrides:{'US|A007F13':'B'}};}
test('confirmed SKU coding splits variable-length SPU, two-digit color and size without numeric coercion',()=>{
 assert.deepEqual(parseSkuCode('A007F1300_34C'),{spu:'A007F13',colorCode:'00',size:'34C'});
 assert.deepEqual(parseSkuCode('A007F1381_42D'),{spu:'A007F13',colorCode:'81',size:'42D'});
 assert.deepEqual(parseSkuCode('24A1304319_L'),{spu:'24A13043',colorCode:'19',size:'L'});
 assert.deepEqual(parseSkuCode('000100_034C'),{spu:'0001',colorCode:'00',size:'034C'});
 for(const sku of ['A007F1300','A007F1300_','A007F1300_34_C','UNRESOLVED-M',123,null])assert.equal(parseSkuCode(sku),null);
});
test('existing raw rows automatically group on upgrade; colors and sizes stay distinct and raw input is untouched',()=>{
 const source=data(),raw=JSON.stringify(source),result=plan(source,'US');assert.equal(result.products.length,1);assert.equal(result.products[0].product,'A007F13');assert.equal(result.items.length,2);
 const m=result.items[0],l=result.items[1];assert.equal(m.productSource,'rule');assert.equal(m.colorCode,'00');assert.equal(m.color,'00');assert.equal(m.size,'34C');assert.equal(l.colorCode,'01');assert.equal(l.size,'34D');assert.equal(m.available,0);assert.equal(l.available,1000);assert.ok(m.sea>0);assert.equal(l.sea,0);assert.equal(JSON.stringify(source),raw);
});
test('manual then explicit source take precedence; source names survive missing metadata in other tables',()=>{
 const source=data();source.sales[0].product='SOURCE-SPU';source.sales[0].color='Black';const result=plan(source,'US');const first=result.items.find(i=>i.sku==='A007F1300_34C');assert.equal(first.product,'SOURCE-SPU');assert.equal(first.productSource,'source');assert.equal(first.color,'Black');assert.equal(first.colorCode,'00');assert.ok(first.warnings.some(w=>w.includes('编码SPU')));
 source.skuMappings={'US|A007F1300_34C':'MANUAL-SPU'};assert.equal(plan(source,'US').items.find(i=>i.sku==='A007F1300_34C').product,'MANUAL-SPU');source.skuMappings={};delete source.sales[0].product;assert.equal(plan(source,'US').items.find(i=>i.sku==='A007F1300_34C').productSource,'rule');
});
test('classification is idempotent and reminder SPUs follow the same rule',()=>{
 const source=data(),once=applyManualMappings(source,'US');assert.deepEqual(applyManualMappings(once,'US'),once);
 const alerts=assessWorkspace({revision:1,isDemo:false,data:source},'US',{today:source.asOf,lookAheadDays:7});assert.ok(alerts.some(a=>a.sku==='A007F1300_34C'&&a.spu==='A007F13'));
});
