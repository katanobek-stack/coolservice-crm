const { test } = require('node:test');
const assert = require('node:assert/strict');
const { receiveStock, consumeStock, returnCost, laborCost } = require('../lib/resourceLogic');
test('weighted stock value, partial use and final rounding reconcile exactly', () => {
  const stock = receiveStock({quantityMilli:1000,valueCents:100},2000,500);
  assert.deepEqual(stock,{quantityMilli:3000,valueCents:600});
  assert.deepEqual(consumeStock(stock,1250),{quantityMilli:1750,valueCents:350,costCents:250});
  assert.deepEqual(consumeStock({quantityMilli:3000,valueCents:100},3000),{quantityMilli:0,valueCents:0,costCents:100});
  assert.throws(()=>consumeStock(stock,3001)); assert.throws(()=>consumeStock(stock,0)); assert.throws(()=>receiveStock(stock,1.5,0));
});
test('unknown costs remain unknown until stock depleted, explicit free receipts remain zero',()=>{
  assert.deepEqual(receiveStock({quantityMilli:1000,valueCents:100},1000,null),{quantityMilli:2000,valueCents:null});
  assert.deepEqual(consumeStock({quantityMilli:1000,valueCents:null},500),{quantityMilli:500,valueCents:null,costCents:null});
  assert.deepEqual(consumeStock({quantityMilli:1000,valueCents:null},1000),{quantityMilli:0,valueCents:0,costCents:null});
  assert.equal(receiveStock({quantityMilli:0,valueCents:0},1000,0).valueCents,0);
});
test('partial returns preserve original cost and labor uses employee minutes',()=>{
  assert.equal(returnCost(100,3000,0,1000),33);
  assert.equal(returnCost(100,3000,1000,1000),34);
  assert.equal(returnCost(100,3000,2000,1000),33);
  assert.equal(returnCost(null,3000,0,1000),null);
  assert.throws(()=>returnCost(100,3000,2500,1000));
  assert.equal(laborCost(90,10000),15000); assert.equal(laborCost(30,null),null);
  assert.throws(()=>laborCost(-1,100)); assert.equal(laborCost(0,null),0);
});
