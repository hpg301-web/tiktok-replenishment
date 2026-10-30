import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, validate, dateAt, dateNumber } from '../src/engine.js';
const asOf='2026-10-30';
function fixture(stock=0) {
  return {asOf,sales:Array.from({length:30},(_,i)=>({market:'US',sku:'001',product:'P',date:dateAt(dateNumber(asOf)-i),units:2,in_stock:true})),inventory:[{market:'US',sku:'001',product:'P',available:stock,snapshot_date:asOf}],pipeline:[],overrides:{'US|P':'B'}};
}
test('defaults yield day22 air and day42 sea; shortages before air remain lost',()=>{
  const i=plan(fixture(),'US').items[0];
  assert.equal(i.airDate,'2026-11-21');assert.equal(i.seaDate,'2026-12-11');
  assert.equal(i.beforeAir,44); assert.equal(i.air,60);assert.equal(i.sea,28);assert.equal(i.lost,44);
  assert.equal(i.daily.length,56);assert.ok(i.daily.every(d=>d.stock>=0));
});
test('late pipeline cannot cancel shortages in an earlier interval',()=>{
  const d=fixture();d.pipeline=[{market:'US',sku:'001',qty:500,shipment_id:'late',eta:'2026-12-10'}];
  const i=plan(d,'US').items[0];assert.equal(i.beforeAir,44);assert.equal(i.air,58);assert.equal(i.sea,0);
});
test('C never schedules air and recomputes sea after lost sales',()=>{
  const d=fixture();d.overrides['US|P']='C';const i=plan(d,'US').items[0];
  assert.equal(i.air,0);assert.equal(i.airReference,50);assert.equal(i.sea,24);assert.equal(i.lost,84);
});
test('missing/stale stock blocks executable quantities and scenarios',()=>{
  for(const inv of [[],[{market:'US',sku:'001',available:0,snapshot_date:'2026-10-29'}]]) {
    const d=fixture();d.inventory=inv;const i=plan(d,'US').items[0];
    assert.equal(i.sea,null);assert.equal(i.air,null);assert.equal(i.scenario,null);assert.deepEqual(i.daily,[]);
  }
});
test('explicit zero stock is valid; SKU leading zeros survive',()=>{const i=plan(fixture(),'US').items[0];assert.equal(i.sku,'001');assert.equal(i.available,0);assert.ok(i.sea>0);});
test('duplicate snapshots and shipments, mixed markets, numeric SKUs are rejected',()=>{
  let d=fixture();d.inventory.push({...d.inventory[0]});assert.throws(()=>validate(d,'US'),/重复/);
  d=fixture();d.pipeline=Array(2).fill({market:'US',sku:'001',qty:10,shipment_id:'same',eta:asOf});assert.throws(()=>validate(d,'US'),/重复/);
  d=fixture();d.inventory[0].market='DE';assert.throws(()=>validate(d,'US'),/市场/);
  d=fixture();d.inventory[0].sku=1;assert.throws(()=>validate(d,'US'),/SKU/);
});
test('unknown, overdue, received and unidentified pipeline is excluded',()=>{
  const d=fixture();d.pipeline=[{eta:undefined},{eta:'2026-10-29'},{eta:asOf,status:'received'},{eta:asOf,shipment_id:undefined}].map((r,i)=>({market:'US',sku:'001',qty:100,shipment_id:String(i),...r}));
  const i=plan(d,'US').items[0];assert.equal(i.pipeline,0);assert.equal(i.air,60);
});
test('explicit stockout days are excluded from demand denominator',()=>{const d=fixture();d.sales.at(-1).in_stock=false;d.sales.at(-1).units=0;assert.equal(plan(d,'US').items[0].demand,2);});
test('stop action preserves pipeline but prevents new shipments',()=>{const d=fixture();d.productSignals={'US|P':{discontinued:true}};d.pipeline=[{market:'US',sku:'001',qty:10,shipment_id:'a',eta:asOf}];const r=plan(d,'US');assert.equal(r.products[0].adoptedAction,'stop');assert.equal(r.items[0].air,0);assert.equal(r.items[0].sea,0);assert.equal(r.items[0].pipeline,10);});
test('nonpositive air contribution blocks air, unknown costs stay null',()=>{const d=fixture();d.productSignals={'US|P':{contribution:2,airExtra:3}};const i=plan(d,'US').items[0];assert.equal(i.air,0);assert.equal(i.sea,48);assert.equal(i.scenario.capital,null);assert.ok(i.scenario.missedContribution>0);});
test('zero demand never generates replenishment',()=>{const d=fixture();d.sales.forEach(r=>r.units=0);const i=plan(d,'US').items[0];assert.equal(i.air,0);assert.equal(i.sea,0);});
test('invalid dates, negative/missing amounts and invalid transport times fail',()=>{assert.throws(()=>dateNumber('2026-02-30'));for(const v of [-1,null,undefined,1.2]){const d=fixture();d.inventory[0].available=v;assert.throws(()=>validate(d));}const d=fixture();d.routes={US:{sea:1}};assert.throws(()=>plan(d,'US'),/时效/);});
test('pressure tests use same shipments; excess inventory is not automatically a loss',()=>{const d=fixture(300);const i=plan(d,'US').items[0];assert.ok(i.scenario.extraStock>0);assert.equal(i.scenario.markdown,null);assert.equal(i.scenario.missedContribution,null);});
