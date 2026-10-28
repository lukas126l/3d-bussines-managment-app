const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

function setup() {
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const writes = [];
  const query = { select() { return this; }, eq() { return this; }, maybeSingle() { return response; } };
  const context = vm.createContext({
    state: { products: [{ id: 1, price: 39 }] }, currentUser: { id: 'test' }, hasUnsyncedChanges: false,
    supabaseClient: { from: () => query }, withTimeout: (promise) => promise,
    emptyState: () => ({ products: [], sales: [], expenses: [], channels: [] }),
    localStorage: { setItem: (...args) => writes.push(args) }, storeKey: 'test', setSyncStatus() {},
  });
  vm.runInContext(source.slice(source.indexOf('async function loadCloudState()'), source.indexOf('async function refreshCloudState()')), context);
  return { context, writes, finish };
}

test('late cloud response does not overwrite a save made during refresh', async () => {
  const app = setup();
  const pending = vm.runInContext('loadCloudState()', app.context);
  vm.runInContext('state.products[0].price = 42; hasUnsyncedChanges = true', app.context);
  app.finish({ data: { data: { products: [{ id: 1, price: 39 }] } } });
  assert.equal(await pending, false);
  assert.equal(app.context.state.products[0].price, 42);
  assert.equal(app.context.hasUnsyncedChanges, true);
  assert.equal(app.writes.length, 0);
});

test('late cloud response cannot overwrite a change already synced or another account', async () => {
  for (const change of ['state.products[0].price = 42', 'currentUser = {id: "other"}']) {
    const app = setup();
    const pending = vm.runInContext('loadCloudState()', app.context);
    vm.runInContext(change, app.context);
    app.finish({ data: { data: { products: [] } } });
    assert.equal(await pending, false);
    assert.equal(app.writes.length, 0);
  }
});

test('unchanged local data accepts a normal cloud refresh', async () => {
  const app = setup();
  const pending = vm.runInContext('loadCloudState()', app.context);
  app.finish({ data: { data: { products: [{ id: 1, price: 50 }] } } });
  assert.equal(await pending, true);
  assert.equal(app.context.state.products[0].price, 50);
  assert.equal(app.writes.length, 1);
});
