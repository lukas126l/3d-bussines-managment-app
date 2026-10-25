const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

test('only completed sales contribute to revenue, profit, charts and channel revenue', () => {
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '' }); return nodes.get(id); };
  node('#sales-analysis-range').value = 'month';
  const state = {
    sales: ['new', 'processing', 'shipped', 'done', 'cancelled'].map((status) => ({ status, amount: status === 'done' ? 100 : 500, date: '2026-10-22', channel: status === 'done' ? 'Paid' : 'Pending' })),
    expenses: [{ amount: 30, date: '2026-10-22' }],
    channels: [{ name: 'Paid', symbol: 'P' }, { name: 'Pending', symbol: 'N' }],
  };
  const context = vm.createContext({ state, now: new Date('2026-10-22T12:00:00Z'), document: { querySelector: node }, sameMonth: () => true, money: String, moneyExact: String, saleItems: () => [{ qty: 1 }], salesRows: () => '', escapeHtml: String, getAnalysisSales: () => state.sales, rangeLabels: { month: 'Ten miesiąc' } });
  vm.runInContext(source.slice(source.indexOf('function renderDashboard()'), source.indexOf('function getFilteredSales()')) + source.slice(source.indexOf('function renderSalesAnalysis()'), source.indexOf('function renderSales()')), context);
  const render = () => vm.runInContext('renderDashboard(); renderSalesAnalysis();', context);
  render();
  assert.equal(node('#metric-revenue').textContent, '100');
  assert.equal(node('#metric-profit').textContent, '70');
  assert.equal(node('#sidebar-profit').textContent, '70');
  assert.equal(node('#analysis-revenue').textContent, '100');
  assert.equal(node('#analysis-average').textContent, '100');
  assert.equal(node('#analysis-sales-value').textContent, '1600');
  assert.equal(node('#analysis-pending-value').textContent, '1500');
  assert.match(node('#channel-breakdown').innerHTML, /<strong>100<\/strong>/);
  assert.match(node('#channel-breakdown').innerHTML, /<strong>0<\/strong>/);
  state.sales[3].status = 'cancelled';
  render();
  assert.equal(node('#metric-revenue').textContent, '0');
  assert.equal(node('#metric-profit').textContent, '-30');
  assert.equal(node('#analysis-average').textContent, '0');
  assert.equal(node('#analysis-sales-value').textContent, '1500');
  assert.equal([...node('#chart').innerHTML.matchAll(/class="bar revenue" style="height:([^"]+)"/g)].every((match) => match[1] === '3%'), true);
  state.sales[0].status = 'done';
  render();
  assert.equal(node('#metric-revenue').textContent, '500');
  assert.equal(node('#analysis-revenue').textContent, '500');
  assert.equal(node('#analysis-sales-value').textContent, '1500');
});

test('pending order value includes every month and only active statuses', () => {
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '' }); return nodes.get(id); };
  node('#sales-analysis-range').value = 'month';
  const currentMonthSales = [{ status: 'done', amount: 90, date: '2026-10-20' }];
  const state = {
    sales: [
      ...currentMonthSales,
      { status: 'new', amount: 100, date: '2026-01-10' },
      { status: 'processing', amount: 200, date: '2025-05-10' },
      { status: 'shipped', amount: 300, date: '2024-08-10' },
      { status: 'done', amount: 400, date: '2025-01-10' },
      { status: 'cancelled', amount: 500, date: '2025-01-10' },
    ],
  };
  const context = vm.createContext({ state, document: { querySelector: node }, moneyExact: String, saleItems: () => [{ qty: 1 }], getAnalysisSales: () => currentMonthSales, rangeLabels: { month: 'Ten miesiąc' } });
  vm.runInContext(source.slice(source.indexOf('function renderSalesAnalysis()'), source.indexOf('function renderSales()')), context);
  vm.runInContext('renderSalesAnalysis();', context);
  assert.equal(node('#analysis-pending-value').textContent, '600');
  assert.equal(node('#analysis-revenue').textContent, '90');
});
