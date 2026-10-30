const storeKey = 'forma-3d-seller-v1';
const themeKey = 'forma-3d-mobile-theme';
const pendingSyncKey = 'forma-3d-pending-sync-v1';
const supabaseUrl = 'https://tgfjjnjbhiiueszxptko.supabase.co';
const supabasePublishableKey = 'sb_publishable_KIukGjgfYDKOfFq0KJH2qQ_DWkeLcOO';
let supabaseClient = null;
let currentUser = null;
let cloudSaveTimer = null;
let cloudRetryTimer = null;
let cloudSyncPromise = null;
let cloudRefreshInFlight = false;
let hasUnsyncedChanges = false;
let cloudRetryAttempt = 0;
const now = new Date();
const iso = (date) => new Date(date).toISOString().slice(0, 10);
const defaultState = {
  sales: [
    { id: 1, product: 'Organizer na biurko', qty: 2, amount: 78, channel: 'Etsy', status: 'shipped', date: iso(now), shipped: true },
    { id: 2, product: 'Stojak na słuchawki', qty: 1, amount: 59, channel: 'Allegro', status: 'processing', date: iso(new Date(now - 864e5 * 2)), shipped: false },
    { id: 3, product: 'Doniczka geometryczna', qty: 3, amount: 105, channel: 'Etsy', status: 'done', date: iso(new Date(now - 864e5 * 7)), shipped: true }
  ],
  products: [
    { id: 1, name: 'Organizer na biurko', stock: 12, price: 39, icon: '▤' },
    { id: 2, name: 'Stojak na słuchawki', stock: 4, price: 59, icon: '◒' },
    { id: 3, name: 'Doniczka geometryczna', stock: 8, price: 35, icon: '✿' }
  ],
  expenses: [
    { id: 1, name: 'Filament PLA — czarny', category: 'Materiały', amount: 86, date: iso(new Date(now - 864e5 * 3)) },
    { id: 2, name: 'Pudełka wysyłkowe', category: 'Pakowanie', amount: 42, date: iso(new Date(now - 864e5 * 8)) }
  ],
  channels: [
    { id: 1, name: 'Etsy', symbol: 'E', color: '#eef6e7' },
    { id: 2, name: 'Allegro', symbol: 'A', color: '#fff0e8' }
  ]
};

const persistedState = localStorage.getItem(storeKey);
let state = persistedState ? JSON.parse(persistedState) : defaultState;
const money = (value) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(value);
const moneyExact = (value) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const emptyState = () => ({ sales: [], products: [], expenses: [], channels: [] });
function save() {
  localStorage.setItem(storeKey, JSON.stringify(state));
  if (!currentUser || !supabaseClient) return;
  hasUnsyncedChanges = true;
  persistPendingState();
  setSyncStatus(navigator.onLine ? 'Zmiana zapisana. Synchronizowanie online…' : 'Zmiana zapisana w telefonie. Czeka na połączenie.');
  queueCloudSync();
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const sameMonth = (date) => { const value = new Date(date); return value.getMonth() === now.getMonth() && value.getFullYear() === now.getFullYear(); };
const statusNames = { new: 'Nowe', processing: 'W realizacji', shipped: 'Wysłane', done: 'Zakończone', cancelled: 'Anulowane' };
const rangeLabels = { month: 'Ten miesiąc', 'last-30': 'Ostatnie 30 dni', year: 'Ten rok', custom: 'Własny zakres dat' };
const fulfillmentText = (sale) => statusNames[sale.status] || statusNames.new;
const calendarMonthLabel = (yearMonth) => new Date(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)) - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase());

function matchesDateRange(date, range, from = '', to = '') {
  const value = String(date).slice(0, 10);
  if (range === 'all') return true;
  if (range === 'today') return value === iso(now);
  if (range === 'month') return sameMonth(value);
  if (range === 'year') return value.slice(0, 4) === String(now.getFullYear());
  if (range.startsWith('calendar-month:')) return value.slice(0, 7) === range.slice('calendar-month:'.length);
  if (range === 'last-30') return value >= iso(new Date(now - 29 * 864e5)) && value <= iso(now);
  if (range === 'custom') return (!from || value >= from) && (!to || value <= to);
  return true;
}

function saleItems(sale) {
  if (Array.isArray(sale.items) && sale.items.length) return sale.items;
  return sale.product ? [{ product: sale.product, qty: Number(sale.qty) || 1 }] : [];
}

// Costs are stored per sale item so later catalog edits never rewrite history.
function productionCost(product) {
  if (!product || ['weightGrams', 'printHours', 'filamentPrice'].some((key) => product[key] === '' || product[key] == null || !Number.isFinite(Number(product[key])) || Number(product[key]) < 0)) return null;
  const rate = Number(product.hourlyRate ?? 0.60);
  const extra = Number(product.extraCost ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(extra) || extra < 0) return null;
  return Number(product.weightGrams) / 1000 * Number(product.filamentPrice) + Number(product.printHours) * rate + extra;
}

function snapshotSaleItem(product, qty, previous) {
  const unitCost = previous?.product === product && typeof previous.unitCost === 'number' ? previous.unitCost : productionCost(state.products.find((entry) => entry.name === product));
  return { product, qty: Number(qty), unitCost };
}

function costedSaleItems(sale) {
  return saleItems(sale).map((item) => {
    const historical = typeof item.unitCost === 'number' && Number.isFinite(item.unitCost) && item.unitCost >= 0;
    return { ...item, unitCost: historical ? item.unitCost : productionCost((state.products || []).find((product) => product.name === item.product)), estimated: !historical };
  });
}

function saleProfit(sale) {
  const items = costedSaleItems(sale);
  if (!items.length || items.some((item) => typeof item.unitCost !== 'number' || !Number.isFinite(item.unitCost) || item.unitCost < 0)) return null;
  const cost = items.reduce((sum, item) => sum + item.unitCost * Number(item.qty), 0) + Number(sale.sellingCosts || 0);
  const profit = Number(sale.amount) - cost;
  return { cost, profit, margin: Number(sale.amount) > 0 ? profit / Number(sale.amount) * 100 : null, estimated: items.some((item) => item.estimated) };
}

function profitabilityMarkup(sale, { showCost = true } = {}) {
  if (sale.status === 'cancelled') return '<span class="muted">Sprzedaż anulowana</span>';
  const result = saleProfit(sale);
  if (!result) return '<span class="muted">Uzupełnij parametry kosztów produktu</span>';
  const margin = result.margin === null ? '—' : `${result.margin.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
  return `<div class="cost-summary">${showCost ? `<span>Koszt: ${moneyExact(result.cost)}</span>` : ''}<strong>${sale.status && sale.status !== 'done' ? 'Prognoza zysku' : 'Zysk'}: ${moneyExact(result.profit)}</strong><span>Marża: ${margin}</span></div>`;
}

function salesProfitSummary(sales) {
  const completed = sales.filter((sale) => sale.status === 'done');
  const results = completed.map(saleProfit);
  const missing = results.filter((result) => result === null).length;
  const revenue = completed.reduce((sum, sale) => sum + Number(sale.amount), 0);
  if (missing) return { revenue, cost: null, profit: null, margin: null, missing };
  const cost = results.reduce((sum, result) => sum + result.cost, 0);
  const profit = revenue - cost;
  return { revenue, cost, profit, margin: revenue > 0 ? profit / revenue * 100 : null, missing: 0 };
}

function renderProfitSummary(prefix, sales) {
  const summary = salesProfitSummary(sales);
  document.querySelector(`#${prefix}-cost`).textContent = summary.cost === null ? '—' : moneyExact(summary.cost);
  document.querySelector(`#${prefix}-profit`).textContent = summary.profit === null ? '—' : moneyExact(summary.profit);
  document.querySelector(`#${prefix}-margin`).textContent = summary.margin === null ? '—' : `${summary.margin.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
  document.querySelector(`#${prefix}-margin-note`).textContent = summary.missing ? `Uzupełnij koszty produktów w ${summary.missing} zakończonych zamówieniach.` : 'Zakończone zamówienia · łączny zysk ÷ łączny przychód';
}

function salesRows(sales) {
  if (!sales.length) return '<div class="empty">Nie ma jeszcze żadnej sprzedaży.</div>';
  return `<table><thead><tr><th>PRODUKTY</th><th>KANAŁ</th><th>DATA</th><th>KWOTA</th><th>ZYSK I MARŻA</th><th>REALIZACJA</th><th></th></tr></thead><tbody>${sales.map((sale) => {
    const products = saleItems(sale).map((item) => `<span>${escapeHtml(item.product)} <b>× ${item.qty}</b></span>`).join('');
    return `<tr><td><div class="sale-products">${products}</div></td><td>${escapeHtml(sale.channel)}</td><td>${new Date(sale.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}</td><td>${moneyExact(sale.amount)}</td><td>${profitabilityMarkup(sale, { showCost: false })}</td><td><span class="status status-${sale.status}">${fulfillmentText(sale)}</span></td><td><div class="row-actions"><button class="row-edit" data-view-sale="${sale.id}">Podgląd</button><button class="row-edit" data-edit-sale="${sale.id}">Edytuj</button><button class="row-delete" data-delete-sale="${sale.id}">Usuń</button></div></td></tr>`;
  }).join('')}</tbody></table>`;
}

function salesCards(sales) {
  if (!sales.length) return '<div class="empty">Nie ma jeszcze żadnej sprzedaży.</div>';
  return sales.map((sale) => {
    const products = saleItems(sale).map((item) => `<span>${escapeHtml(item.product)} <b>× ${item.qty}</b></span>`).join('');
    const date = new Date(sale.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    return `<article class="sales-mobile-card"><div class="sales-mobile-card-top"><div class="sale-products">${products}</div><strong>${moneyExact(sale.amount)}</strong></div><div class="sales-mobile-meta"><span>${escapeHtml(sale.channel)}</span><span>${date}</span><span class="status status-${sale.status}">${fulfillmentText(sale)}</span></div>${profitabilityMarkup(sale, { showCost: false })}<div class="sales-mobile-actions"><button class="row-edit" data-view-sale="${sale.id}">Podgląd</button><button class="row-edit" data-edit-sale="${sale.id}">Edytuj</button><button class="row-delete" data-delete-sale="${sale.id}">Usuń</button></div></article>`;
  }).join('');
}

function salesList(sales) {
  return `<div class="sales-table-desktop">${salesRows(sales)}</div><div class="sales-list-mobile">${salesCards(sales)}</div>`;
}

function renderDashboard() {
  const monthlySales = state.sales.filter((sale) => sameMonth(sale.date));
  const completedSales = monthlySales.filter((sale) => sale.status === 'done');
  const monthlyExpenses = state.expenses.filter((expense) => sameMonth(expense.date));
  const revenue = completedSales.reduce((total, sale) => total + sale.amount, 0);
  const expenses = monthlyExpenses.reduce((total, expense) => total + expense.amount, 0);
  const units = monthlySales.reduce((total, sale) => total + saleItems(sale).reduce((sum, item) => sum + Number(item.qty), 0), 0);
  const profit = revenue - expenses;

  document.querySelector('#metric-revenue').textContent = money(revenue);
  document.querySelector('#metric-expenses').textContent = money(expenses);
  document.querySelector('#metric-profit').textContent = money(profit);
  document.querySelector('#metric-units').textContent = units;
  document.querySelector('#metric-revenue-note').textContent = completedSales.length ? `Zakończone zamówienia: ${completedSales.length}` : 'Brak zakończonych zamówień';
  document.querySelector('#metric-expenses-note').textContent = monthlyExpenses.length ? `${monthlyExpenses.length} pozycji kosztowych` : 'Dodaj pierwszy koszt';
  document.querySelector('#sidebar-profit').textContent = money(profit);
  document.querySelector('#sidebar-month').textContent = now.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase());
  document.querySelector('#recent-sales').innerHTML = salesRows(state.sales.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5));

  const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
  let highestValue = 1;
  const data = months.map((month) => {
    const inMonth = (date) => { const value = new Date(date); return value.getMonth() === month.getMonth() && value.getFullYear() === month.getFullYear(); };
    const monthRevenue = state.sales.filter((sale) => sale.status === 'done' && inMonth(sale.date)).reduce((sum, sale) => sum + sale.amount, 0);
    const monthExpenses = state.expenses.filter((expense) => inMonth(expense.date)).reduce((sum, expense) => sum + expense.amount, 0);
    highestValue = Math.max(highestValue, monthRevenue, monthExpenses);
    return { month, revenue: monthRevenue, expenses: monthExpenses };
  });
  document.querySelector('#chart').innerHTML = data.map((item) => `<div class="chart-group"><i class="bar revenue" style="height:${Math.max(3, item.revenue / highestValue * 100)}%"></i><i class="bar expense" style="height:${Math.max(3, item.expenses / highestValue * 100)}%"></i></div>`).join('');
  document.querySelector('#chart-months').innerHTML = data.map((item) => `<span>${item.month.toLocaleDateString('pl-PL', { month: 'short' })}</span>`).join('');

  const channelTotals = state.channels.map((channel) => ({ ...channel, value: completedSales.filter((sale) => sale.channel === channel.name).reduce((sum, sale) => sum + sale.amount, 0) }));
  const topChannel = Math.max(1, ...channelTotals.map((channel) => channel.value));
  document.querySelector('#channel-breakdown').innerHTML = channelTotals.length ? channelTotals.map((channel) => `<div class="channel-row"><i class="channel-icon">${escapeHtml(channel.symbol)}</i><div><b>${escapeHtml(channel.name)}</b><div class="progress"><i style="width:${channel.value / topChannel * 100}%"></i></div></div><strong>${money(channel.value)}</strong></div>`).join('') : '<p class="muted">Dodaj pierwszy kanał.</p>';
}

function getFilteredSales() {
  const query = document.querySelector('#sales-search').value.toLowerCase();
  const status = document.querySelector('#sales-status-filter').value;
  return state.sales.filter((sale) => (status === 'all' || sale.status === status) && saleItems(sale).some((item) => item.product.toLowerCase().includes(query))).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getAnalysisSales() {
  return state.sales.filter((sale) => matchesDateRange(sale.date, document.querySelector('#sales-analysis-range').value, document.querySelector('#sales-date-from').value, document.querySelector('#sales-date-to').value));
}

function renderSalesAnalysis() {
  const sales = getAnalysisSales();
  const completedSales = sales.filter((sale) => sale.status === 'done');
  renderProfitSummary('analysis-sales', sales);
  const pendingStatuses = new Set(['new', 'processing', 'shipped']);
  const revenue = completedSales.reduce((sum, sale) => sum + sale.amount, 0);
  const units = sales.reduce((sum, sale) => sum + saleItems(sale).reduce((itemSum, item) => itemSum + Number(item.qty), 0), 0);
  const salesValue = sales.filter((sale) => sale.status !== 'cancelled').reduce((sum, sale) => sum + sale.amount, 0);
  const pendingValue = state.sales.filter((sale) => pendingStatuses.has(sale.status)).reduce((sum, sale) => sum + sale.amount, 0);
  const range = document.querySelector('#sales-analysis-range').value;
  const from = document.querySelector('#sales-date-from').value;
  const to = document.querySelector('#sales-date-to').value;
  document.querySelector('#analysis-revenue').textContent = moneyExact(revenue);
  document.querySelector('#analysis-orders').textContent = sales.length;
  document.querySelector('#analysis-units').textContent = units;
  document.querySelector('#analysis-average').textContent = moneyExact(completedSales.length ? revenue / completedSales.length : 0);
  document.querySelector('#analysis-sales-value').textContent = moneyExact(salesValue);
  document.querySelector('#analysis-pending-value').textContent = moneyExact(pendingValue);
  const rangeLabel = range.startsWith('calendar-month:') ? calendarMonthLabel(range.slice('calendar-month:'.length)) : rangeLabels[range];
  document.querySelector('#sales-analysis-description').textContent = range === 'custom' && (from || to) ? `${from ? `Od ${new Date(from).toLocaleDateString('pl-PL')}` : 'Od początku'} ${to ? `do ${new Date(to).toLocaleDateString('pl-PL')}` : 'do dziś'}` : rangeLabel;
}

function renderSales() { document.querySelector('#sales-table').innerHTML = salesList(getFilteredSales()); renderSalesAnalysis(); }

function renderInventory() {
  document.querySelector('#inventory-grid').innerHTML = state.products.length ? `<div class="table-wrap"><table><thead><tr><th>PRODUKT</th><th>CENA BAZOWA</th><th>CENY W KANAŁACH</th><th>KOSZT / SZT.</th><th>REALIZACJA</th><th></th></tr></thead><tbody>${state.products.map((product) => {
    const channelPrices = Object.entries(product.channelPrices || {}).filter(([, price]) => Number(price) > 0);
    const priceList = channelPrices.length ? channelPrices.map(([channel, price]) => `<span class="channel-price"><b>${escapeHtml(channel)}</b>${moneyExact(price)}</span>`).join('') : '<span class="muted">Brak cen kanałowych</span>';
    return `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${moneyExact(product.price)}</td><td><div class="channel-prices">${priceList}</div></td><td>${productionCost(product) === null ? '<span class="muted">Uzupełnij koszty</span>' : moneyExact(productionCost(product))}</td><td><span class="on-demand">Druk na zamówienie</span></td><td><div class="row-actions"><button class="row-edit" data-view-product="${product.id}">Podgląd</button><button class="row-edit" data-edit-product="${product.id}">Edytuj</button><button class="row-delete" data-delete-product="${product.id}">Usuń</button></div></td></tr>`;
  }).join('')}</tbody></table></div>` : '<div class="empty">Nie dodano jeszcze produktów.</div>';
}

function calculatePriceFloor(cost, targetMargin, extraCost = 0, feePercent = 0, offer = 0) {
  if ([cost, targetMargin, extraCost, feePercent, offer].some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0) || targetMargin + feePercent >= 100) return null;
  const fixedCost = cost + extraCost;
  const ceilMoney = (value) => Math.ceil((value - 1e-9) * 100) / 100;
  const minimum = ceilMoney(fixedCost / (1 - (targetMargin + feePercent) / 100));
  const breakEven = ceilMoney(fixedCost / (1 - feePercent / 100));
  const profit = offer * (1 - feePercent / 100) - fixedCost;
  return { minimum, breakEven, profit, margin: offer > 0 ? profit / offer * 100 : null, acceptable: offer >= minimum && offer > 0 };
}

function showInventoryTab(tab) {
  document.querySelector('#inventory-grid').hidden = tab === 'calculator';
  document.querySelector('#pricing-calculator').hidden = tab !== 'calculator';
  document.querySelectorAll('[data-inventory-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.inventoryTab === tab)));
}

function renderPricingCalculator() {
  const productSelect = document.querySelector('#pricing-product');
  const channelSelect = document.querySelector('#pricing-channel');
  const oldProduct = productSelect.value;
  productSelect.innerHTML = state.products.length ? state.products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('') : '<option value="">Najpierw dodaj produkt</option>';
  if (state.products.some((product) => String(product.id) === oldProduct)) productSelect.value = oldProduct;
  const selectedProduct = () => state.products.find((product) => String(product.id) === productSelect.value);
  const updateResults = () => {
    const product = selectedProduct();
    const cost = productionCost(product);
    const resultRoot = document.querySelector('#pricing-results');
    if (!product || cost === null) {
      resultRoot.innerHTML = `<p class="pricing-message">${product ? 'Uzupełnij gramaturę, czas druku i cenę filamentu w produkcie, aby obliczyć minimalną cenę.' : 'Dodaj produkt, aby rozpocząć obliczenia.'}</p>`;
      return;
    }
    const values = ['margin', 'extra', 'fee', 'offer'].map((name) => {
      const input = document.querySelector(`#pricing-${name}`);
      return input.value.trim() === '' || !input.validity.valid ? NaN : Number(input.value);
    });
    const result = calculatePriceFloor(cost, values[0], values[1], values[2], values[3]);
    if (!result) {
      resultRoot.innerHTML = '<p class="pricing-message" role="alert">Wpisz poprawne, nieujemne wartości. Suma marży i prowizji musi być mniejsza niż 100%.</p>';
      return;
    }
    const catalogPrice = Number(product.channelPrices?.[channelSelect.value] ?? product.price ?? 0);
    const discount = catalogPrice - result.minimum;
    const margin = result.margin === null ? '—' : `${result.margin.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
    resultRoot.innerHTML = `<section class="pricing-floor"><span>Twoja minimalna cena / szt.</span><strong>${moneyExact(result.minimum)}</strong><p>Przy minimalnej marży ${values[0].toLocaleString('pl-PL')}%</p></section><section class="pricing-offer ${result.acceptable ? 'is-acceptable' : 'is-below'}"><strong>${result.acceptable ? 'Oferta spełnia Twój próg marży' : 'Oferta poniżej Twojego progu'}</strong><div class="pricing-numbers"><div><span>Zysk przy tej ofercie</span><b>${moneyExact(result.profit)}</b></div><div><span>Marża przy tej ofercie</span><b>${margin}</b></div></div></section><dl class="detail-grid">${[['Cena katalogowa', moneyExact(catalogPrice)], ['Koszt produkcji / szt.', moneyExact(cost)], ['Cena bez straty', moneyExact(result.breakEven)], [discount >= 0 ? 'Możesz zejść z ceny o' : 'Cena katalogowa poniżej progu o', moneyExact(Math.abs(discount))]].map(([label, value]) => `<div class="detail-value"><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="form-hint">Zysk i marża przed podatkiem i kosztami ogólnymi. Cena minimalna jest zaokrąglana w górę do pełnego grosza.</p>`;
  };
  let channelProductId = oldProduct;
  const loadChannels = (resetOffer) => {
    const product = selectedProduct();
    const previous = channelSelect.value;
    const preserveChannel = channelProductId === productSelect.value && channelSelect.options.length > 0;
    const prices = Object.entries(product?.channelPrices || {}).filter(([, price]) => Number(price) > 0);
    channelSelect.innerHTML = '<option value="">Cena bazowa</option>' + prices.map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    channelSelect.value = preserveChannel && (previous === '' || prices.some(([name]) => name === previous)) ? previous : (prices.find(([name]) => name.toLowerCase() === 'vinted')?.[0] || '');
    channelProductId = productSelect.value;
    if (resetOffer || previous !== channelSelect.value) document.querySelector('#pricing-offer').value = product ? Number(product.channelPrices?.[channelSelect.value] ?? product.price ?? 0).toFixed(2) : '';
    updateResults();
  };
  productSelect.onchange = () => loadChannels(true);
  channelSelect.onchange = () => {
    const product = selectedProduct();
    document.querySelector('#pricing-offer').value = Number(product?.channelPrices?.[channelSelect.value] ?? product?.price ?? 0).toFixed(2);
    updateResults();
  };
  ['margin', 'extra', 'fee', 'offer'].forEach((name) => { document.querySelector(`#pricing-${name}`).oninput = updateResults; });
  document.querySelectorAll('[data-inventory-tab]').forEach((button) => { button.onclick = () => showInventoryTab(button.dataset.inventoryTab); });
  loadChannels(oldProduct !== productSelect.value || document.querySelector('#pricing-offer').value === '');
}

function getFilteredExpenses() {
  const query = document.querySelector('#expense-search').value.toLowerCase();
  const category = document.querySelector('#expense-category-filter').value;
  const range = document.querySelector('#expense-period-filter').value;
  const from = document.querySelector('#expense-date-from').value;
  const to = document.querySelector('#expense-date-to').value;
  return state.expenses.filter((expense) => (category === 'all' || expense.category === category) && expense.name.toLowerCase().includes(query) && matchesDateRange(expense.date, range, from, to)).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderExpenses() {
  const total = state.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const monthly = state.expenses.filter((expense) => sameMonth(expense.date)).reduce((sum, expense) => sum + expense.amount, 0);
  const expenses = getFilteredExpenses();
  document.querySelector('#total-expenses').textContent = moneyExact(total);
  document.querySelector('#monthly-expenses').textContent = moneyExact(monthly);
  document.querySelector('#expenses-table').innerHTML = expenses.length ? `<table><thead><tr><th>NAZWA KOSZTU</th><th>KATEGORIA</th><th>DATA</th><th>KWOTA</th><th></th></tr></thead><tbody>${expenses.map((expense) => `<tr><td>${escapeHtml(expense.name)}</td><td>${escapeHtml(expense.category)}</td><td>${new Date(expense.date).toLocaleDateString('pl-PL')}</td><td>${moneyExact(expense.amount)}</td><td><div class="row-actions"><button class="row-edit" data-edit-expense="${expense.id}">Edytuj</button><button class="row-delete" data-delete-expense="${expense.id}">Usuń</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Brak kosztów spełniających wybrane filtry.</div>';
}

function renderChannels() {
  document.querySelector('#channels-grid').innerHTML = state.channels.map((channel) => { const count = state.sales.filter((sale) => sale.channel === channel.name).length; return `<article class="channel-card"><div class="channel-badge" style="background:${channel.color}">${escapeHtml(channel.symbol)}</div><strong>${count} zam.</strong><h3>${escapeHtml(channel.name)}</h3><p>Aktywny kanał sprzedaży</p><div class="channel-actions"><button class="channel-edit" data-edit-channel="${channel.id}">Edytuj</button><button class="channel-delete" data-delete-channel="${channel.id}">Usuń</button></div></article>`; }).join('');
}

function renderAll() { renderDashboard(); renderSales(); renderInventory(); renderPricingCalculator(); renderExpenses(); renderChannels(); }

function setAuthMessage(message, isError = false) {
  const target = document.querySelector('#auth-message');
  target.textContent = message;
  target.classList.toggle('is-error', isError);
}

function setSyncStatus(message) {
  const target = document.querySelector('#sync-status');
  if (target) target.textContent = message;
}

function setAppUpdateStatus(message) {
  const target = document.querySelector('#app-update-status');
  if (target) target.textContent = message;
}

function withTimeout(promise, milliseconds = 15000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Przekroczono czas połączenia. Sprawdź internet i spróbuj ponownie.')), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function readPendingState() {
  try { return JSON.parse(localStorage.getItem(pendingSyncKey) || 'null'); } catch { return null; }
}

function persistPendingState() {
  if (!currentUser) return;
  localStorage.setItem(pendingSyncKey, JSON.stringify({ userId: currentUser.id, data: state, updatedAt: new Date().toISOString() }));
}

function clearPendingState() {
  const pending = readPendingState();
  if (!pending || pending.userId === currentUser?.id) localStorage.removeItem(pendingSyncKey);
}

function restorePendingState() {
  const pending = readPendingState();
  if (!pending?.data || pending.userId !== currentUser?.id) return false;
  state = { ...emptyState(), ...pending.data };
  localStorage.setItem(storeKey, JSON.stringify(state));
  hasUnsyncedChanges = true;
  return true;
}

function queueCloudSync(delay = 350) {
  if (!currentUser || !supabaseClient) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => { cloudSaveTimer = null; void syncStateToCloud(); }, delay);
}

function scheduleCloudRetry() {
  const delays = [3000, 10000, 30000, 60000];
  const delay = delays[Math.min(cloudRetryAttempt, delays.length - 1)];
  cloudRetryAttempt += 1;
  clearTimeout(cloudRetryTimer);
  cloudRetryTimer = setTimeout(() => { cloudRetryTimer = null; void syncStateToCloud(); }, delay);
  setSyncStatus(navigator.onLine ? 'Zmiana zapisana w telefonie. Ponowię synchronizację automatycznie.' : 'Zmiana zapisana w telefonie. Czeka na połączenie z internetem.');
}

async function syncStateToCloud() {
  if (!currentUser || !supabaseClient || !hasUnsyncedChanges) return !hasUnsyncedChanges;
  if (cloudSyncPromise) return cloudSyncPromise;
  cloudSyncPromise = (async () => {
    if (!navigator.onLine) { scheduleCloudRetry(); return false; }
    clearTimeout(cloudRetryTimer);
    try {
      while (hasUnsyncedChanges) {
        const snapshot = JSON.stringify(state);
        setSyncStatus('Zapisywanie zmian online…');
        const { data: sessionData, error: sessionError } = await withTimeout(supabaseClient.auth.getSession());
        if (sessionError || !sessionData.session || sessionData.session.user.id !== currentUser.id) throw new Error('Sesja logowania wygasła.');
        const { error } = await withTimeout(supabaseClient.from('forma_state').upsert({
          user_id: currentUser.id,
          data: JSON.parse(snapshot),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' }));
        if (error) throw error;
        if (JSON.stringify(state) === snapshot) {
          hasUnsyncedChanges = false;
          clearPendingState();
          cloudRetryAttempt = 0;
        }
      }
      setSyncStatus('Wszystkie dane są zsynchronizowane.');
      return true;
    } catch (error) {
      persistPendingState();
      scheduleCloudRetry();
      return false;
    }
  })();
  try { return await cloudSyncPromise; } finally { cloudSyncPromise = null; }
}

async function loadCloudState() {
  if (hasUnsyncedChanges && !(await syncStateToCloud())) return false;
  try {
    const requestedState = JSON.stringify(state);
    const requestedUserId = currentUser.id;
    const { data, error } = await withTimeout(supabaseClient.from('forma_state').select('data').eq('user_id', requestedUserId).maybeSingle());
    // Never overwrite edits saved while the cloud request was in flight.
    if (currentUser?.id !== requestedUserId || hasUnsyncedChanges || JSON.stringify(state) !== requestedState) return false;
    if (error) {
      setSyncStatus('Nie udało się pobrać danych z bazy.');
      return false;
    }
    if (data?.data) {
      state = { ...emptyState(), ...data.data };
      localStorage.setItem(storeKey, JSON.stringify(state));
      hasUnsyncedChanges = false;
    } else {
      state = persistedState ? state : emptyState();
      hasUnsyncedChanges = true;
      persistPendingState();
      return syncStateToCloud();
    }
    return true;
  } catch (error) {
    setSyncStatus('Nie udało się pobrać danych. Sprawdź połączenie.');
    return false;
  }
}

async function refreshCloudState() {
  if (cloudRefreshInFlight) { setSyncStatus('Synchronizacja już trwa…'); return false; }
  if (!supabaseClient) { setSyncStatus('Łączenie z bazą nie zostało uruchomione. Odśwież aplikację i spróbuj ponownie.'); return false; }
  if (!navigator.onLine) {
    setSyncStatus(hasUnsyncedChanges ? 'Zmiana jest zapisana w tym urządzeniu i czeka na internet.' : 'Brak połączenia z internetem.');
    return false;
  }
  cloudRefreshInFlight = true;
  try {
    const { data: sessionData, error: sessionError } = await withTimeout(supabaseClient.auth.getSession());
    const session = sessionData?.session;
    if (sessionError || !session) {
      setSyncStatus('Sesja na tym urządzeniu wygasła. Wyloguj się i zaloguj ponownie.');
      return false;
    }
    if (!currentUser || currentUser.id !== session.user.id) {
      currentUser = null;
      return activateSession(session);
    }
    if (hasUnsyncedChanges && !(await syncStateToCloud())) return false;
    setSyncStatus('Pobieranie nowych danych z chmury…');
    const synced = await loadCloudState();
    if (synced) {
      renderAll();
      setSyncStatus('Wszystkie dane są zsynchronizowane.');
    }
    return synced;
  } catch (error) {
    setSyncStatus('Nie udało się odświeżyć danych. Sprawdź połączenie.');
    return false;
  } finally {
    cloudRefreshInFlight = false;
  }
}

async function activateSession(session) {
  if (!session?.user || currentUser?.id === session.user.id) return false;
  currentUser = session.user;
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#app-shell').hidden = false;
  const restoredPendingState = restorePendingState();
  setSyncStatus(restoredPendingState ? 'Przywrócono zmianę zapisaną w telefonie. Synchronizowanie…' : 'Pobieranie danych z chmury…');
  const synced = restoredPendingState ? await syncStateToCloud() : await loadCloudState();
  renderAll();
  if (synced) setSyncStatus('Wszystkie dane są zsynchronizowane.');
  return synced;
}

async function initialiseCloud() {
  if (!window.supabase) { setAuthMessage('Nie udało się uruchomić połączenia z bazą.', true); return; }
  try {
    supabaseClient = window.supabase.createClient(supabaseUrl, supabasePublishableKey);
    const { data: { session } } = await withTimeout(supabaseClient.auth.getSession());
    if (session) await activateSession(session);
    supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      // Leave the auth callback before starting other Supabase operations.
      if (nextSession) setTimeout(() => { void activateSession(nextSession); }, 0);
    });
  } catch (error) {
    setAuthMessage(error.message || 'Nie udało się połączyć z bazą.', true);
  }
}

const fields = {
  sale: [['amount', 'Łączna kwota sprzedaży (zł)', 'number'], ['channel', 'Kanał', 'select'], ['date', 'Data sprzedaży', 'date'], ['status', 'Status realizacji', 'select'], ['sellingCosts', 'Opłaty i wysyłka po naszej stronie (zł)', 'number']],
  product: [['name', 'Nazwa produktu', 'text', 'full'], ['price', 'Cena sprzedaży (zł)', 'number'], ['weightGrams', 'Zużycie filamentu z odpadami (g/szt.)', 'number'], ['printHours', 'Czas druku (h/szt., np. 1,5)', 'number'], ['filamentPrice', 'Cena filamentu (zł/kg)', 'number'], ['hourlyRate', 'Koszt godziny druku (zł/h)', 'number'], ['extraCost', 'Dodatki i opakowanie (zł/szt.)', 'number']],
  expense: [['name', 'Nazwa kosztu', 'text', 'full'], ['category', 'Kategoria', 'select'], ['amount', 'Kwota (zł)', 'number'], ['date', 'Data', 'date']],
  channel: [['name', 'Nazwa kanału', 'text', 'full'], ['symbol', 'Skrót (1–2 litery)', 'text']]
};

function options(name) {
  if (name === 'channel') return state.channels.map((channel) => [channel.name, channel.name]);
  if (name === 'status') return Object.entries(statusNames);
  if (name === 'category') return ['Materiały', 'Pakowanie', 'Wysyłka', 'Narzędzia', 'Opłata Vinted', 'Opłata OLX', 'Inne'].map((value) => [value, value]);
  return [];
}

function productPrice(productName, channelName = '') {
  const product = state.products.find((entry) => entry.name === productName);
  if (!product) return 0;
  return Number(product.channelPrices?.[channelName] || product.price || 0);
}

function valueFor(field, record) {
  if (record && record[field] !== undefined && record[field] !== null) return record[field];
  if (field === 'hourlyRate') return 0.60;
  if (field === 'extraCost' || field === 'sellingCosts') return 0;
  if (field === 'date') return iso(now);
  if (field === 'qty' || field === 'stock') return 1;
  return '';
}

function fieldMarkup([name, label, type, className], record) {
  const value = valueFor(name, record);
  const full = className || '';
  if (type === 'select') {
    const placeholder = name === 'channel' ? `<option value="" ${!value ? 'selected' : ''} disabled>Wybierz kanał</option>` : '';
    return `<div class="field ${full}"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" required>${placeholder}${options(name).map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${String(optionValue) === String(value) ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}</select></div>`;
  }
  const numberOptions = name === 'stock' ? 'min="0" step="1"' : type === 'number' ? 'min="0" step="0.01"' : '';
  return `<div class="field ${full}"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${numberOptions} ${['weightGrams', 'printHours', 'filamentPrice'].includes(name) ? '' : 'required'} /></div>`;
}

function saleItemMarkup(item = {}) {
  const selected = item.product || '';
  return `<div class="sale-item-row"><select class="sale-product" aria-label="Produkt" required><option value="" ${!selected ? 'selected' : ''} disabled>Wybierz produkt</option>${state.products.map((product) => `<option value="${escapeHtml(product.name)}" ${product.name === selected ? 'selected' : ''}>${escapeHtml(product.name)}</option>`).join('')}</select><input class="sale-qty" type="number" min="1" step="1" value="${Number(item.qty) || 1}" aria-label="Liczba sztuk" /><button type="button" class="remove-sale-item" aria-label="Usuń produkt">×</button></div>`;
}

function productChannelPricesMarkup(record) {
  if (!state.channels.length) return '<p class="form-hint full">Dodaj kanał sprzedaży, aby ustawić dla niego osobną cenę.</p>';
  return `<div class="field full"><label>Ceny dla kanałów sprzedaży</label><p class="form-hint">Opcjonalne. Jeśli zostawisz puste, obowiązuje cena bazowa.</p><div class="channel-price-fields">${state.channels.map((channel) => {
    const value = record?.channelPrices?.[channel.name] ?? '';
    return `<label class="channel-price-field"><span>${escapeHtml(channel.name)}</span><input class="channel-price-input" data-channel-name="${escapeHtml(channel.name)}" type="number" min="0" step="0.01" value="${escapeHtml(value)}" placeholder="${escapeHtml(String(record?.price || ''))}" /></label>`;
  }).join('')}</div></div>`;
}

function openDetails(type, id) {
  const record = (type === 'product' ? state.products : state.sales).find((entry) => entry.id === id);
  if (!record) return;
  const root = document.querySelector('#modal-root');
  root.innerHTML = '';
  root.append(document.querySelector('#modal-template').content.cloneNode(true));
  const modal = root.querySelector('.modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'modal-title');
  root.querySelector('#modal-kicker').textContent = 'PODGLĄD';
  root.querySelector('#modal-title').textContent = type === 'product' ? record.name : 'Szczegóły sprzedaży';
  const detail = (label, value) => `<div class="detail-value"><dt>${label}</dt><dd>${value}</dd></div>`;
  const number = (value, suffix) => value == null || value === '' ? '—' : `${escapeHtml(value)} ${suffix}`;
  let content;
  if (type === 'product') {
    const cost = productionCost(record);
    const prices = [['Cena bazowa', record.price], ...Object.entries(record.channelPrices || {}).filter(([, price]) => Number(price) > 0)];
    const profitCards = prices.map(([name, price]) => {
      const result = saleProfit({ amount: price, items: [{ product: record.name, qty: 1, unitCost: cost }] });
      const margin = result?.margin == null ? '—' : `${result.margin.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
      return `<section class="product-profit-card${result && result.profit < 0 ? ' is-loss' : ''}"><div class="product-profit-heading"><span>${escapeHtml(name)}</span><span>Marża: ${margin}</span></div><span class="product-profit-label">${result && result.profit < 0 ? 'Strata' : 'Zysk'} na sztuce</span><strong class="product-profit-value">${result ? moneyExact(result.profit) : '—'}</strong><div class="product-profit-meta"><span>Cena: ${moneyExact(price)}</span><span>Koszt: ${cost === null ? 'uzupełnij parametry' : moneyExact(cost)}</span></div></section>`;
    }).join('');
    content = `<div class="detail-prices">${profitCards}</div><p class="form-hint">Przed opłatami sprzedaży, wysyłką, podatkiem i kosztami ogólnymi.</p><h3>Parametry druku</h3><dl class="detail-grid">${detail('Zużycie filamentu / szt.', number(record.weightGrams, 'g'))}${detail('Czas druku / szt.', number(record.printHours, 'h'))}${detail('Cena filamentu', record.filamentPrice == null ? '—' : moneyExact(record.filamentPrice) + ' / kg')}${detail('Stawka druku', moneyExact(record.hourlyRate ?? 0.60) + ' / h')}${detail('Dodatki / szt.', moneyExact(record.extraCost ?? 0))}${detail('Koszt produkcji / szt.', cost === null ? 'Uzupełnij parametry produktu' : moneyExact(cost))}</dl>`;
  } else {
    const items = costedSaleItems(record);
    content = `<dl class="detail-grid">${detail('Kanał', escapeHtml(record.channel))}${detail('Data sprzedaży', escapeHtml(record.date))}${detail('Realizacja', escapeHtml(fulfillmentText(record)))}${detail('Kwota sprzedaży', moneyExact(record.amount))}${detail('Opłaty i wysyłka po naszej stronie', moneyExact(record.sellingCosts || 0))}</dl><h3>Produkty i koszty produkcji</h3><div class="detail-prices">${items.map((item) => `<section class="cost-preview"><strong>${escapeHtml(item.product)} × ${escapeHtml(item.qty)}</strong><p>${item.unitCost === null ? 'Brak parametrów kosztów — uzupełnij produkt.' : `${moneyExact(item.unitCost)} / szt. · razem ${moneyExact(item.unitCost * item.qty)}`}</p></section>`).join('')}</div><section class="cost-preview">${profitabilityMarkup(record)}</section><p class="form-hint">Wynik przed podatkiem i kosztami ogólnymi. Dla niezakończonych zamówień jest prognozą.</p>`;
  }
  root.querySelector('#modal-fields').className = 'detail-content';
  root.querySelector('#modal-fields').innerHTML = content;
  root.querySelector('.modal-actions').innerHTML = '<button type="button" class="secondary-button detail-close">Zamknij</button><button type="button" class="primary-button detail-edit">Edytuj</button>';
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-close').onclick = close;
  root.querySelector('.detail-close').onclick = close;
  root.querySelector('.detail-edit').onclick = () => { close(); openModal(type, id); };
  modal.onsubmit = (event) => event.preventDefault();
  modal.onkeydown = (event) => { if (event.key === 'Escape') close(); };
  root.querySelector('.detail-close').focus();
}

function openModal(type, id = null) {
  const collection = type === 'sale' ? state.sales : type === 'product' ? state.products : type === 'expense' ? state.expenses : state.channels;
  let record = id === null ? null : collection.find((entry) => entry.id === id);
  const editing = Boolean(record);
  const root = document.querySelector('#modal-root');
  const template = document.querySelector('#modal-template').content.cloneNode(true);
  root.append(template);
  const modal = root.querySelector('.modal');
  const titles = { sale: editing ? 'Edytuj sprzedaż' : 'Dodaj sprzedaż', product: editing ? 'Edytuj produkt' : 'Dodaj produkt', expense: editing ? 'Edytuj koszt' : 'Dodaj koszt', channel: editing ? 'Edytuj kanał' : 'Dodaj kanał' };
  root.querySelector('#modal-title').textContent = titles[type];
  root.querySelector('#modal-kicker').textContent = editing ? 'EDYCJA' : type === 'sale' ? 'NOWE ZAMÓWIENIE' : 'NOWY WPIS';
  const formFields = root.querySelector('#modal-fields');
  formFields.innerHTML = `${type === 'sale' ? '<div class="field full"><label>Produkty w sprzedaży</label><div id="sale-items" class="sale-items"></div><button type="button" id="add-sale-item" class="add-sale-item">+ Dodaj kolejny produkt</button></div>' : ''}${fields[type].map((field) => fieldMarkup(field, record)).join('')}${type === 'product' ? productChannelPricesMarkup(record) : ''}`;

  if (type === 'product' || type === 'sale') {
    formFields.insertAdjacentHTML('beforeend', '<div id="cost-preview" class="cost-preview field full" aria-live="polite"></div>');
  }
  const readItems = () => [...modal.querySelectorAll('.sale-item-row')].map((row) => {
    const product = row.querySelector('.sale-product').value;
    const previous = row.dataset.unitCost === undefined ? null : { product: row.dataset.costProduct, unitCost: Number(row.dataset.unitCost) };
    return snapshotSaleItem(product, row.querySelector('.sale-qty').value, previous);
  }).filter((item) => item.product && item.qty > 0);
  const updateCostPreview = () => {
    const preview = root.querySelector('#cost-preview');
    if (!preview) return;
    if (type === 'product') {
      const cost = productionCost(Object.fromEntries(new FormData(modal)));
      preview.innerHTML = `<strong>Koszt produkcji / szt.: ${cost === null ? 'uzupełnij parametry' : moneyExact(cost)}</strong><p class="form-hint">Stawka 0,60 zł/h: szacunkowo 0,15 zł prądu + 0,45 zł zużycia Bambu Lab A1. Możesz ją zmienić. Czas 1,5 h oznacza 1 godz. 30 min. Gramatura powinna uwzględniać podpory i odpady.</p>`;
    } else {
      preview.innerHTML = profitabilityMarkup({ status: root.querySelector('#field-status').value, amount: root.querySelector('#field-amount').value, sellingCosts: root.querySelector('#field-sellingCosts').value, items: readItems() }) + '<p class="form-hint">Wynik przed podatkiem i kosztami ogólnymi. Przy niezakończonym zamówieniu jest prognozą. Nie dodawaj ponownie opakowania uwzględnionego w produkcie. Brak historycznych kosztów można uzupełnić, zapisując sprzedaż po uzupełnieniu produktu.</p>';
    }
  };
  modal.addEventListener('input', updateCostPreview);
  modal.addEventListener('change', updateCostPreview);

  if (type === 'sale') {
    const list = root.querySelector('#sale-items');
    const addItem = (item) => {
      list.insertAdjacentHTML('beforeend', saleItemMarkup(item));
      if (typeof item.unitCost === 'number') {
        list.lastElementChild.dataset.costProduct = item.product;
        list.lastElementChild.dataset.unitCost = String(item.unitCost);
      }
    };
    (record ? saleItems(record) : [{}]).forEach(addItem);
    let manualAmount = editing;
    root.querySelector('#field-amount').addEventListener('input', (event) => { manualAmount = event.target.value.trim() !== ''; });
    const updateAmount = () => {
      if (manualAmount) return;
      const amountField = root.querySelector('#field-amount');
      const channel = root.querySelector('#field-channel').value;
      const total = [...list.querySelectorAll('.sale-item-row')].reduce((sum, row) => sum + productPrice(row.querySelector('.sale-product').value, channel) * Math.max(0, Number(row.querySelector('.sale-qty').value) || 0), 0);
      amountField.value = total ? total.toFixed(2).replace(/\.00$/, '') : '';
    };
    root.querySelector('#add-sale-item').onclick = () => { addItem({}); updateAmount(); updateCostPreview(); };
    list.onclick = (event) => { if (event.target.closest('.remove-sale-item') && list.querySelectorAll('.sale-item-row').length > 1) { event.target.closest('.sale-item-row').remove(); updateAmount(); updateCostPreview(); } };
    list.onchange = updateAmount;
    list.oninput = updateAmount;
    root.querySelector('#field-channel').onchange = updateAmount;
  }

  updateCostPreview();
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-close').onclick = close;
  root.querySelector('.modal-cancel').onclick = close;
  modal.onsubmit = (event) => {
    event.preventDefault();
    // A cloud refresh can replace the collection while this form stays open.
    if (editing) {
      const currentCollection = type === 'sale' ? state.sales : type === 'product' ? state.products : type === 'expense' ? state.expenses : state.channels;
      record = currentCollection.find((entry) => entry.id === id);
      if (!record) {
        alert('Ten wpis został usunięty podczas edycji. Zamknij formularz i odśwież listę.');
        return;
      }
    }
    const value = Object.fromEntries(new FormData(modal));
    if (type === 'sale') {
      const items = readItems();
      value.sellingCosts = Number(value.sellingCosts);
      if (!items.length) return;
      value.id = editing ? record.id : Date.now();
      value.amount = Number(value.amount);
      value.items = items;
      value.shipped = ['shipped', 'done'].includes(value.status);
      if (editing) Object.assign(record, value); else state.sales.unshift(value);
    }
    if (type === 'product') {
      value.price = Number(value.price);
      ['weightGrams', 'printHours', 'filamentPrice', 'hourlyRate', 'extraCost'].forEach((key) => { value[key] = value[key] === '' ? null : Number(value[key]); });
      value.channelPrices = Object.fromEntries([...modal.querySelectorAll('.channel-price-input')].map((input) => [input.dataset.channelName, Number(input.value)]).filter(([, price]) => Number.isFinite(price) && price > 0));
      if (editing) {
        const oldName = record.name;
        Object.assign(record, value);
        if (oldName !== value.name) state.sales.forEach((sale) => { saleItems(sale).forEach((item) => { if (item.product === oldName) item.product = value.name; }); if (!sale.items && sale.product === oldName) sale.product = value.name; });
      } else state.products.push({ id: Date.now(), ...value, icon: '▤' });
    }
    if (type === 'expense') {
      value.amount = Number(value.amount);
      if (editing) Object.assign(record, value); else state.expenses.push({ id: Date.now(), ...value });
    }
    if (type === 'channel') {
      value.symbol = value.symbol.toUpperCase();
      if (editing) {
        const oldName = record.name;
        Object.assign(record, value);
        if (oldName !== value.name) state.sales.forEach((sale) => { if (sale.channel === oldName) sale.channel = value.name; });
      } else state.channels.push({ id: Date.now(), ...value, color: '#eef6e7' });
    }
    save(); close(); renderAll();
  };
}

document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => {
  const view = button.dataset.view;
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active-view', section.id === view));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#page-title').innerHTML = view === 'dashboard' ? 'Dzień dobry, Łukasz <span class="sun">☀</span>' : ({ sales: 'Sprzedaż', inventory: 'Produkty', expenses: 'Koszty', channels: 'Kanały', settings: 'Ustawienia' }[view]);
  document.querySelector('#page-kicker').textContent = view === 'dashboard' ? 'TWOJA PRACOWNIA' : `FORMA / ${{ sales: 'SPRZEDAŻ', inventory: 'PRODUKTY', expenses: 'KOSZTY', channels: 'KANAŁY', settings: 'USTAWIENIA' }[view]}`;
});
document.querySelectorAll('[data-action]').forEach((button) => button.onclick = () => openModal(button.dataset.action.replace('new-', '')));
document.addEventListener('click', (event) => {
  const viewSale = event.target.closest('[data-view-sale]');
  const viewProduct = event.target.closest('[data-view-product]');
  if (viewSale) openDetails('sale', Number(viewSale.dataset.viewSale));
  if (viewProduct) openDetails('product', Number(viewProduct.dataset.viewProduct));
  const saleButton = event.target.closest('[data-edit-sale]');
  const productButton = event.target.closest('[data-edit-product]');
  const channelButton = event.target.closest('[data-edit-channel]');
  const deleteChannelButton = event.target.closest('[data-delete-channel]');
  const expenseButton = event.target.closest('[data-edit-expense]');
  const deleteSaleButton = event.target.closest('[data-delete-sale]');
  const deleteProductButton = event.target.closest('[data-delete-product]');
  const deleteExpenseButton = event.target.closest('[data-delete-expense]');
  if (saleButton) openModal('sale', Number(saleButton.dataset.editSale));
  if (productButton) openModal('product', Number(productButton.dataset.editProduct));
  if (channelButton) openModal('channel', Number(channelButton.dataset.editChannel));
  if (expenseButton) openModal('expense', Number(expenseButton.dataset.editExpense));
  if (deleteChannelButton) {
    const channel = state.channels.find((item) => item.id === Number(deleteChannelButton.dataset.deleteChannel));
    const orders = state.sales.filter((sale) => sale.channel === channel?.name).length;
    if (orders) { alert(`Kanał „${channel.name}” ma ${orders} zam. Najpierw zmień kanał w tych sprzedażach.`); return; }
    if (confirm(`Usunąć kanał „${channel.name}”?`)) { state.channels = state.channels.filter((item) => item.id !== channel.id); save(); renderAll(); }
  }
  if (deleteSaleButton) {
    const sale = state.sales.find((item) => item.id === Number(deleteSaleButton.dataset.deleteSale));
    if (sale && confirm('Usunąć tę sprzedaż?')) { state.sales = state.sales.filter((item) => item.id !== sale.id); save(); renderAll(); }
  }
  if (deleteProductButton) {
    const product = state.products.find((item) => item.id === Number(deleteProductButton.dataset.deleteProduct));
    const orders = state.sales.filter((sale) => saleItems(sale).some((item) => item.product === product?.name)).length;
    if (orders) { alert(`Produkt „${product.name}” występuje w ${orders} zam. Nie można go usunąć, aby zachować historię.`); return; }
    if (product && confirm(`Usunąć produkt „${product.name}”?`)) { state.products = state.products.filter((item) => item.id !== product.id); save(); renderAll(); }
  }
  if (deleteExpenseButton) {
    const expense = state.expenses.find((item) => item.id === Number(deleteExpenseButton.dataset.deleteExpense));
    if (expense && confirm(`Usunąć koszt „${expense.name}”?`)) { state.expenses = state.expenses.filter((item) => item.id !== expense.id); save(); renderAll(); }
  }
});
document.querySelector('#sales-search').oninput = renderSales;
document.querySelector('#sales-status-filter').onchange = renderSales;
const salesAnalysisRange = document.querySelector('#sales-analysis-range');
const salesCustomRange = document.querySelector('#sales-custom-range');
function addRecentCalendarMonths() {
  const selected = salesAnalysisRange.value;
  const currentDate = new Date();
  const recentMonths = Array.from({ length: 3 }, (_, index) => {
    const month = new Date(currentDate.getFullYear(), currentDate.getMonth() - index - 1, 1);
    const yearMonth = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    return `<option value="calendar-month:${yearMonth}">${calendarMonthLabel(yearMonth)}</option>`;
  }).join('');
  salesAnalysisRange.innerHTML = `<option value="month">Ten miesiąc</option>${recentMonths}<option value="year">Ten rok</option><option value="custom">Własny zakres dat</option>`;
  salesAnalysisRange.value = [...salesAnalysisRange.options].some((option) => option.value === selected) ? selected : 'month';
}
function toggleSalesCustomRange() { salesCustomRange.hidden = salesAnalysisRange.value !== 'custom'; }
salesAnalysisRange.onchange = () => { toggleSalesCustomRange(); renderSalesAnalysis(); };
document.querySelector('#sales-date-from').onchange = renderSalesAnalysis;
document.querySelector('#sales-date-to').onchange = renderSalesAnalysis;

const expensePeriodFilter = document.querySelector('#expense-period-filter');
const expenseCustomRange = document.querySelector('#expense-custom-range');
function toggleExpenseCustomRange() { expenseCustomRange.hidden = expensePeriodFilter.value !== 'custom'; }
expensePeriodFilter.onchange = () => { toggleExpenseCustomRange(); renderExpenses(); };
document.querySelector('#expense-search').oninput = renderExpenses;
document.querySelector('#expense-category-filter').onchange = renderExpenses;
document.querySelector('#expense-date-from').onchange = renderExpenses;
document.querySelector('#expense-date-to').onchange = renderExpenses;
document.querySelector('#reset-data').onclick = () => { if (confirm('Usunąć wszystkie dane?')) { localStorage.removeItem(storeKey); state = emptyState(); save(); renderAll(); } };
document.querySelector('#auth-form').onsubmit = async (event) => {
  event.preventDefault();
  const email = document.querySelector('#auth-email').value.trim();
  const password = document.querySelector('#auth-password').value;
  setAuthMessage('Logowanie…');
  try {
    const { error } = await withTimeout(supabaseClient.auth.signInWithPassword({ email, password }));
    if (error) { setAuthMessage(error.message, true); return; }
    const { data: { session } } = await withTimeout(supabaseClient.auth.getSession());
    if (session) await activateSession(session);
    else setAuthMessage('Logowanie nie utworzyło sesji. Odśwież stronę i spróbuj ponownie.', true);
  } catch (error) {
    setAuthMessage(error.message || 'Nie udało się zalogować.', true);
  }
};
document.querySelector('#auth-signup').onclick = async () => {
  const email = document.querySelector('#auth-email').value.trim();
  const password = document.querySelector('#auth-password').value;
  if (!email || password.length < 8) { setAuthMessage('Wpisz e-mail oraz hasło o długości co najmniej 8 znaków.', true); return; }
  setAuthMessage('Tworzenie konta…');
  try {
    const { error } = await withTimeout(supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } }));
    setAuthMessage(error ? error.message : 'Sprawdź e-mail i potwierdź utworzenie konta.', Boolean(error));
  } catch (error) {
    setAuthMessage(error.message || 'Nie udało się utworzyć konta.', true);
  }
};
document.querySelector('#sign-out').onclick = async () => { await supabaseClient.auth.signOut(); currentUser = null; document.querySelector('#app-shell').hidden = true; document.querySelector('#auth-screen').hidden = false; setAuthMessage('Wylogowano.'); };
document.querySelector('#refresh-data').onclick = async () => {
  const button = document.querySelector('#refresh-data');
  button.disabled = true;
  setSyncStatus('Sprawdzanie połączenia z chmurą…');
  await refreshCloudState();
  button.disabled = false;
};

async function refreshApplication() {
  const button = document.querySelector('#check-updates');
  button.disabled = true;
  setAppUpdateStatus('Pobieranie najnowszej wersji…');
  try {
    if (!('serviceWorker' in navigator)) {
      window.location.reload();
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      window.location.reload();
      return;
    }
    await registration.update();
    if (registration.installing || registration.waiting) {
      const worker = registration.installing || registration.waiting;
      await withTimeout(new Promise((resolve, reject) => {
        const checkState = () => {
          if (worker.state === 'activated' || worker.state === 'redundant') {
            worker.removeEventListener('statechange', checkState);
            if (worker.state === 'activated') resolve();
            else reject(new Error('Nie udało się zainstalować aktualizacji.'));
          } else if (worker.state === 'installed') {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        };
        worker.addEventListener('statechange', checkState);
        checkState();
      }), 30000);
    }
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    setAppUpdateStatus('Aktualizacja pobrana. Uruchamiam aplikację ponownie…');
    window.setTimeout(() => window.location.reload(), 900);
    return true;
  } catch (error) {
    button.disabled = false;
    setAppUpdateStatus('Nie udało się pobrać aktualizacji. Sprawdź połączenie z internetem i spróbuj ponownie.');
    return false;
  }
}
document.querySelector('#check-updates').onclick = refreshApplication;

const mobileThemeToggle = document.querySelector('#mobile-theme-toggle');
const mobileViewport = window.matchMedia('(max-width: 600px)');
function applyTheme() {
  const selectedTheme = localStorage.getItem(themeKey) || 'dark';
  const theme = mobileViewport.matches ? selectedTheme : 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#101d34' : '#f5f7fb');
  mobileThemeToggle.textContent = theme === 'dark' ? 'Włącz tryb jasny' : 'Włącz tryb ciemny';
  mobileThemeToggle.setAttribute('aria-pressed', String(theme === 'light'));
}
mobileThemeToggle.onclick = () => {
  const activeTheme = document.documentElement.dataset.theme;
  localStorage.setItem(themeKey, activeTheme === 'dark' ? 'light' : 'dark');
  applyTheme();
};
mobileViewport.addEventListener('change', applyTheme);
applyTheme();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshCloudState();
});
window.addEventListener('focus', () => { addRecentCalendarMonths(); refreshCloudState(); });
window.addEventListener('online', () => {
  if (hasUnsyncedChanges) {
    setSyncStatus('Połączenie odzyskane. Wysyłanie zapisanych zmian…');
    queueCloudSync(0);
  } else {
    refreshCloudState();
  }
});
window.addEventListener('offline', () => {
  if (hasUnsyncedChanges) setSyncStatus('Zmiana zapisana w telefonie. Czeka na połączenie z internetem.');
});
addRecentCalendarMonths();
toggleSalesCustomRange();
toggleExpenseCustomRange();
renderAll();
initialiseCloud();

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}


// Capture only deliberate downward gestures that begin at the page's top.
function initialisePullRefresh() {
  const shell = document.querySelector('#app-shell');
  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 12M4 12l2.3 6A7 7 0 0 0 17.9 17"/></svg><span></span>';
  document.body.append(indicator);
  const label = indicator.querySelector('span');
  const icon = indicator.querySelector('svg');
  let start = null;
  let distance = 0;
  let busy = false;
  let resetTimer;
  const threshold = 80;
  const blocked = () => shell.hidden || Boolean(document.querySelector('#modal-root').firstElementChild) || document.querySelector('#check-updates').disabled;
  const reset = () => {
    start = null;
    distance = 0;
    indicator.classList.remove('is-visible', 'is-ready', 'is-loading');
  };
  document.addEventListener('touchstart', (event) => {
    if (busy) return;
    clearTimeout(resetTimer);
    reset();
    if (event.touches.length !== 1 || window.scrollY > 0 || blocked()) return;
    if (event.target.closest('input, textarea, select, button, a, [contenteditable], .table-wrap, .mobile-nav')) return;
    // Leave independently scrollable areas to their native touch handling.
    for (let node = event.target; node && node !== document.body; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
    }
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!start || busy) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || blocked() || window.scrollY > 0 || !event.cancelable) { reset(); return; }
    const dy = touch.clientY - start.y;
    if (dy < 0 || Math.abs(touch.clientX - start.x) > Math.max(12, dy)) { reset(); return; }
    event.preventDefault();
    distance = Math.min(112, dy * 0.5);
    indicator.style.setProperty('--pull-distance', `${distance}px`);
    icon.style.transform = `rotate(${distance / threshold * 240}deg)`;
    indicator.classList.toggle('is-visible', distance > 8);
    indicator.classList.toggle('is-ready', distance >= threshold);
    const text = distance >= threshold ? 'Puść, aby odświeżyć' : 'Pociągnij, aby odświeżyć';
    if (label.textContent !== text) label.textContent = text;
  }, { passive: false });
  document.addEventListener('touchcancel', () => { if (!busy) reset(); }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!start || busy) return;
    if (distance < threshold || blocked()) { reset(); return; }
    start = null;
    busy = true;
    indicator.classList.add('is-loading');
    label.textContent = 'Odświeżanie aplikacji…';
    try {
      const result = await refreshApplication();
      if (result !== false) return; // Keep the spinner until navigation.
      label.textContent = 'Nie udało się odświeżyć. Spróbuj ponownie.';
    } catch {
      label.textContent = 'Nie udało się odświeżyć. Spróbuj ponownie.';
    }
    indicator.classList.remove('is-loading');
    busy = false;
    resetTimer = setTimeout(reset, 3000);
  }, { passive: true });
}
initialisePullRefresh();
