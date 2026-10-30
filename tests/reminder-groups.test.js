import test from 'node:test';import assert from 'node:assert/strict';
import {groupReminders} from '../src/reminder-ui.js';
test('SPU grouping combines alerts for distinct color/size SKUs while keeping unknown identifiers separate',()=>{
 const alerts=[{market:'US',sku:'001-M',product:'P',spu:'P'},{market:'US',sku:'001-M',product:'P',spu:'P'},{market:'US',sku:'001-L',product:'P',spu:'P'},{market:'US',sku:'002-M',product:'Q',spu:'Q'},{market:'US',sku:'003',product:'003',spu:null},{market:'US',sku:null,spu:null}];
 const groups=groupReminders(alerts);assert.equal(groups.length,4);assert.deepEqual(groups[0].skus,['001-M','001-L']);assert.equal(groups[0].alerts.length,3);assert.equal(groups[1].spu,'Q');assert.equal(groups[2].kind,'unmapped');assert.equal(groups[3].kind,'market');
});
