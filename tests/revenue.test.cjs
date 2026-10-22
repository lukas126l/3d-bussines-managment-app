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
  assert.equal(node('#analysis-channel').textContent, 'Paid');
  assert.match(node('#channel-breakdown').innerHTML, /<strong>100<\/strong>/);
  assert.match(node('#channel-breakdown').innerHTML, /<strong>0<\/strong>/);
  state.sales[3].status = 'cancelled';
  render();
  assert.equal(node('#metric-revenue').textContent, '0');
  assert.equal(node('#metric-profit').textContent, '-30');
  assert.equal(node('#analysis-average').textContent, '0');
  assert.equal(node('#analysis-channel').textContent, '—');
  assert.equal([...node('#chart').innerHTML.matchAll(/class="bar revenue" style="height:([^"]+)"/g)].every((match) => match[1] === '3%'), true);
  state.sales[0].status = 'done';
  render();
  assert.equal(node('#metric-revenue').textContent, '500');
  assert.equal(node('#analysis-revenue').textContent, '500');
});
