const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const state = { products: [{ name: 'Test', weightGrams: 100, printHours: 3, filamentPrice: 80 }] };
const ctx = vm.createContext({ state, moneyExact: (n) => n.toFixed(2) });
vm.runInContext(source.slice(source.indexOf('function saleItems('), source.indexOf('function salesRows(')), ctx);
const run = (code) => vm.runInContext(code, ctx);

test('material, default machine rate and extras produce a unit cost', () => {
  assert.equal(run('productionCost(state.products[0])'), 9.8);
  assert.equal(run('productionCost({...state.products[0], hourlyRate: 2, extraCost: 2})'), 16);
  assert.equal(run('productionCost({...state.products[0], hourlyRate: 0})'), 8);
});
test('missing or invalid costs never become zero-cost production', () => {
  for (const value of ['null', 'undefined', "''", '-1', 'NaN']) {
    assert.equal(run(`productionCost({...state.products[0], weightGrams: ${value}})`), null);
  }
  assert.equal(run('saleProfit({amount: 40, items: [{product: "Test", qty: 1}]})'), null);
});
test('multiple quantities, selling fees, loss and zero revenue', () => {
  assert.equal(run('saleProfit({amount: 40, sellingCosts: 4, items: [{qty: 2, unitCost: 16}]}).profit'), 4);
  assert.equal(run('saleProfit({amount: 40, sellingCosts: 4, items: [{qty: 2, unitCost: 16}]}).margin'), 10);
  assert.equal(run('saleProfit({amount: 0, items: [{qty: 1, unitCost: 16}]}).margin'), null);
  assert.equal(run('saleProfit({amount: 10, items: [{qty: 1, unitCost: 16}]}).profit'), -6);
});
test('catalog updates preserve historical costs, including a zero cost', () => {
  run('globalThis.original = snapshotSaleItem("Test", 1); state.products[0].filamentPrice = 100');
  assert.equal(run('snapshotSaleItem("Test", 2, original).unitCost'), 9.8);
  assert.equal(run('snapshotSaleItem("Test", 2).unitCost'), 11.8);
  assert.equal(run('snapshotSaleItem("Test", 2, {product: "Test", unitCost: 0}).unitCost'), 0);
  assert.equal(run('snapshotSaleItem("Test", 2, {product: "Test", unitCost: null}).unitCost'), 11.8);
});
