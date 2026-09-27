const storeKey = 'forma-3d-seller-v1';
const themeKey = 'forma-3d-mobile-theme';
const supabaseUrl = 'https://tgfjjnjbhiiueszxptko.supabase.co';
const supabasePublishableKey = 'sb_publishable_KIukGjgfYDKOfFq0KJH2qQ_DWkeLcOO';
let supabaseClient = null;
let currentUser = null;
let cloudSaveTimer = null;
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
const emptyState = () => ({ sales: [], products: [], expenses: [], channels: [] });
function save() {
  localStorage.setItem(storeKey, JSON.stringify(state));
  if (!currentUser || !supabaseClient) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(syncStateToCloud, 250);
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const sameMonth = (date) => { const value = new Date(date); return value.getMonth() === now.getMonth() && value.getFullYear() === now.getFullYear(); };
const statusNames = { new: 'Nowe', processing: 'W realizacji', shipped: 'Wysłane', done: 'Zakończone' };
const rangeLabels = { month: 'Ten miesiąc', 'last-30': 'Ostatnie 30 dni', year: 'Ten rok', custom: 'Własny zakres' };

function matchesDateRange(date, range, from = '', to = '') {
  const value = String(date).slice(0, 10);
  if (range === 'all') return true;
  if (range === 'today') return value === iso(now);
  if (range === 'month') return sameMonth(value);
  if (range === 'year') return value.slice(0, 4) === String(now.getFullYear());
  if (range === 'last-30') return value >= iso(new Date(now - 29 * 864e5)) && value <= iso(now);
  if (range === 'custom') return (!from || value >= from) && (!to || value <= to);
  return true;
}

function saleItems(sale) {
  if (Array.isArray(sale.items) && sale.items.length) return sale.items;
  return sale.product ? [{ product: sale.product, qty: Number(sale.qty) || 1 }] : [];
}

function salesRows(sales) {
  if (!sales.length) return '<div class="empty">Nie ma jeszcze żadnej sprzedaży.</div>';
  return `<table><thead><tr><th>PRODUKTY</th><th>KANAŁ</th><th>DATA</th><th>KWOTA</th><th>STATUS</th><th></th></tr></thead><tbody>${sales.map((sale) => {
    const products = saleItems(sale).map((item) => `<span>${escapeHtml(item.product)} <b>× ${item.qty}</b></span>`).join('');
    return `<tr><td><div class="sale-products">${products}</div></td><td>${escapeHtml(sale.channel)}</td><td>${new Date(sale.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}</td><td>${money(sale.amount)}</td><td><span class="status status-${sale.status}">${statusNames[sale.status]}</span></td><td><div class="row-actions"><button class="row-edit" data-edit-sale="${sale.id}">Edytuj</button><button class="row-delete" data-delete-sale="${sale.id}">Usuń</button></div></td></tr>`;
  }).join('')}</tbody></table>`;
}

function renderDashboard() {
  const monthlySales = state.sales.filter((sale) => sameMonth(sale.date));
  const monthlyExpenses = state.expenses.filter((expense) => sameMonth(expense.date));
  const revenue = monthlySales.reduce((total, sale) => total + sale.amount, 0);
  const expenses = monthlyExpenses.reduce((total, expense) => total + expense.amount, 0);
  const units = monthlySales.reduce((total, sale) => total + saleItems(sale).reduce((sum, item) => sum + Number(item.qty), 0), 0);
  const profit = revenue - expenses;

  document.querySelector('#metric-revenue').textContent = money(revenue);
  document.querySelector('#metric-expenses').textContent = money(expenses);
  document.querySelector('#metric-profit').textContent = money(profit);
  document.querySelector('#metric-units').textContent = units;
  document.querySelector('#metric-revenue-note').textContent = monthlySales.length ? `${monthlySales.length} zamówień w tym miesiącu` : 'Brak sprzedaży w tym miesiącu';
  document.querySelector('#metric-expenses-note').textContent = monthlyExpenses.length ? `${monthlyExpenses.length} pozycji kosztowych` : 'Dodaj pierwszy koszt';
  document.querySelector('#sidebar-profit').textContent = money(profit);
  document.querySelector('#sidebar-month').textContent = now.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase());
  document.querySelector('#recent-sales').innerHTML = salesRows(state.sales.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5));

  const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
  let highestValue = 1;
  const data = months.map((month) => {
    const inMonth = (date) => { const value = new Date(date); return value.getMonth() === month.getMonth() && value.getFullYear() === month.getFullYear(); };
    const monthRevenue = state.sales.filter((sale) => inMonth(sale.date)).reduce((sum, sale) => sum + sale.amount, 0);
    const monthExpenses = state.expenses.filter((expense) => inMonth(expense.date)).reduce((sum, expense) => sum + expense.amount, 0);
    highestValue = Math.max(highestValue, monthRevenue, monthExpenses);
    return { month, revenue: monthRevenue, expenses: monthExpenses };
  });
  document.querySelector('#chart').innerHTML = data.map((item) => `<div class="chart-group"><i class="bar revenue" style="height:${Math.max(3, item.revenue / highestValue * 100)}%"></i><i class="bar expense" style="height:${Math.max(3, item.expenses / highestValue * 100)}%"></i></div>`).join('');
  document.querySelector('#chart-months').innerHTML = data.map((item) => `<span>${item.month.toLocaleDateString('pl-PL', { month: 'short' })}</span>`).join('');

  const channelTotals = state.channels.map((channel) => ({ ...channel, value: monthlySales.filter((sale) => sale.channel === channel.name).reduce((sum, sale) => sum + sale.amount, 0) }));
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
  const revenue = sales.reduce((sum, sale) => sum + sale.amount, 0);
  const units = sales.reduce((sum, sale) => sum + saleItems(sale).reduce((itemSum, item) => itemSum + Number(item.qty), 0), 0);
  const channelTotals = sales.reduce((totals, sale) => ({ ...totals, [sale.channel]: (totals[sale.channel] || 0) + sale.amount }), {});
  const bestChannel = Object.entries(channelTotals).sort((a, b) => b[1] - a[1])[0];
  const range = document.querySelector('#sales-analysis-range').value;
  const from = document.querySelector('#sales-date-from').value;
  const to = document.querySelector('#sales-date-to').value;
  document.querySelector('#analysis-revenue').textContent = money(revenue);
  document.querySelector('#analysis-orders').textContent = sales.length;
  document.querySelector('#analysis-units').textContent = units;
  document.querySelector('#analysis-average').textContent = money(sales.length ? revenue / sales.length : 0);
  document.querySelector('#analysis-channel').textContent = bestChannel ? bestChannel[0] : '—';
  document.querySelector('#sales-analysis-description').textContent = range === 'custom' && (from || to) ? `${from ? `Od ${new Date(from).toLocaleDateString('pl-PL')}` : 'Od początku'} ${to ? `do ${new Date(to).toLocaleDateString('pl-PL')}` : 'do dziś'}` : rangeLabels[range];
}

function renderSales() { document.querySelector('#sales-table').innerHTML = salesRows(getFilteredSales()); renderSalesAnalysis(); }

function renderInventory() {
  document.querySelector('#inventory-grid').innerHTML = state.products.length ? `<div class="table-wrap"><table><thead><tr><th>PRODUKT</th><th>CENA BAZOWA</th><th>CENY W KANAŁACH</th><th>REALIZACJA</th><th></th></tr></thead><tbody>${state.products.map((product) => {
    const channelPrices = Object.entries(product.channelPrices || {}).filter(([, price]) => Number(price) > 0);
    const priceList = channelPrices.length ? channelPrices.map(([channel, price]) => `<span class="channel-price"><b>${escapeHtml(channel)}</b>${money(price)}</span>`).join('') : '<span class="muted">Brak cen kanałowych</span>';
    return `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${money(product.price)}</td><td><div class="channel-prices">${priceList}</div></td><td><span class="on-demand">Druk na zamówienie</span></td><td><div class="row-actions"><button class="row-edit" data-edit-product="${product.id}">Edytuj</button><button class="row-delete" data-delete-product="${product.id}">Usuń</button></div></td></tr>`;
  }).join('')}</tbody></table></div>` : '<div class="empty">Nie dodano jeszcze produktów.</div>';
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
  document.querySelector('#total-expenses').textContent = money(total);
  document.querySelector('#monthly-expenses').textContent = money(monthly);
  document.querySelector('#expenses-table').innerHTML = expenses.length ? `<table><thead><tr><th>NAZWA KOSZTU</th><th>KATEGORIA</th><th>DATA</th><th>KWOTA</th><th></th></tr></thead><tbody>${expenses.map((expense) => `<tr><td>${escapeHtml(expense.name)}</td><td>${escapeHtml(expense.category)}</td><td>${new Date(expense.date).toLocaleDateString('pl-PL')}</td><td>${money(expense.amount)}</td><td><div class="row-actions"><button class="row-edit" data-edit-expense="${expense.id}">Edytuj</button><button class="row-delete" data-delete-expense="${expense.id}">Usuń</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Brak kosztów spełniających wybrane filtry.</div>';
}

function renderChannels() {
  document.querySelector('#channels-grid').innerHTML = state.channels.map((channel) => { const count = state.sales.filter((sale) => sale.channel === channel.name).length; return `<article class="channel-card"><div class="channel-badge" style="background:${channel.color}">${escapeHtml(channel.symbol)}</div><strong>${count} zam.</strong><h3>${escapeHtml(channel.name)}</h3><p>Aktywny kanał sprzedaży</p><div class="channel-actions"><button class="channel-edit" data-edit-channel="${channel.id}">Edytuj</button><button class="channel-delete" data-delete-channel="${channel.id}">Usuń</button></div></article>`; }).join('');
}

function renderAll() { renderDashboard(); renderSales(); renderInventory(); renderExpenses(); renderChannels(); }

function setAuthMessage(message, isError = false) {
  const target = document.querySelector('#auth-message');
  target.textContent = message;
  target.classList.toggle('is-error', isError);
}

function setSyncStatus(message) {
  const target = document.querySelector('#sync-status');
  if (target) target.textContent = message;
}

function withTimeout(promise, milliseconds = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Przekroczono czas połączenia. Sprawdź internet i spróbuj ponownie.')), milliseconds))
  ]);
}

async function syncStateToCloud() {
  if (!currentUser || !supabaseClient) return;
  setSyncStatus('Zapisywanie zmian online…');
  const { error } = await supabaseClient.from('forma_state').upsert({
    user_id: currentUser.id,
    data: state,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  setSyncStatus(error ? 'Nie udało się zapisać zmian. Sprawdź połączenie.' : 'Wszystkie dane są zsynchronizowane.');
}

async function loadCloudState() {
  const { data, error } = await supabaseClient.from('forma_state').select('data').eq('user_id', currentUser.id).maybeSingle();
  if (error) {
    setSyncStatus('Baza nie jest jeszcze gotowa — uruchom skrypt konfiguracji.');
    return false;
  }
  if (data?.data) {
    state = { ...emptyState(), ...data.data };
    localStorage.setItem(storeKey, JSON.stringify(state));
  } else {
    state = persistedState ? state : emptyState();
    await syncStateToCloud();
  }
  return true;
}

async function activateSession(session) {
  if (!session?.user || currentUser?.id === session.user.id) return;
  currentUser = session.user;
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#app-shell').hidden = false;
  setSyncStatus('Pobieranie danych z chmury…');
  const synced = await loadCloudState();
  renderAll();
  if (synced) setSyncStatus('Wszystkie dane są zsynchronizowane.');
}

async function initialiseCloud() {
  if (!window.supabase) { setAuthMessage('Nie udało się uruchomić połączenia z bazą.', true); return; }
  try {
    supabaseClient = window.supabase.createClient(supabaseUrl, supabasePublishableKey);
    const { data: { session } } = await withTimeout(supabaseClient.auth.getSession());
    if (session) await activateSession(session);
    supabaseClient.auth.onAuthStateChange((_event, nextSession) => { if (nextSession) activateSession(nextSession); });
  } catch (error) {
    setAuthMessage(error.message || 'Nie udało się połączyć z bazą.', true);
  }
}

const fields = {
  sale: [['amount', 'Łączna kwota sprzedaży (zł)', 'number'], ['channel', 'Kanał', 'select'], ['date', 'Data sprzedaży', 'date'], ['status', 'Status', 'select'], ['shipped', 'Przesyłka nadana', 'select']],
  product: [['name', 'Nazwa produktu', 'text', 'full'], ['price', 'Cena sprzedaży (zł)', 'number']],
  expense: [['name', 'Nazwa kosztu', 'text', 'full'], ['category', 'Kategoria', 'select'], ['amount', 'Kwota (zł)', 'number'], ['date', 'Data', 'date']],
  channel: [['name', 'Nazwa kanału', 'text', 'full'], ['symbol', 'Skrót (1–2 litery)', 'text']]
};

function options(name) {
  if (name === 'channel') return state.channels.map((channel) => [channel.name, channel.name]);
  if (name === 'status') return Object.entries(statusNames);
  if (name === 'shipped') return [['false', 'Nie, jeszcze nie'], ['true', 'Tak, wysłane']];
  if (name === 'category') return ['Materiały', 'Pakowanie', 'Wysyłka', 'Narzędzia', 'Opłata Vinted', 'Opłata OLX', 'Inne'].map((value) => [value, value]);
  return [];
}

function productPrice(productName, channelName = '') {
  const product = state.products.find((entry) => entry.name === productName);
  if (!product) return 0;
  return Number(product.channelPrices?.[channelName] || product.price || 0);
}

function valueFor(field, record) {
  if (record && record[field] !== undefined) return record[field];
  if (field === 'date') return iso(now);
  if (field === 'qty' || field === 'stock') return 1;
  if (field === 'shipped') return 'false';
  return '';
}

function fieldMarkup([name, label, type, className], record) {
  const value = valueFor(name, record);
  const full = className || '';
  if (type === 'select') {
    const placeholder = name === 'channel' ? `<option value="" ${!value ? 'selected' : ''} disabled>Wybierz kanał</option>` : '';
    return `<div class="field ${full}"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" required>${placeholder}${options(name).map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${String(optionValue) === String(value) ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}</select></div>`;
  }
  const numberOptions = name === 'stock' ? 'min="0" step="1"' : name === 'amount' || name === 'price' ? 'min="0" step="0.01"' : '';
  return `<div class="field ${full}"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${numberOptions} required /></div>`;
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

function openModal(type, id = null) {
  const collection = type === 'sale' ? state.sales : type === 'product' ? state.products : type === 'expense' ? state.expenses : state.channels;
  const record = id === null ? null : collection.find((entry) => entry.id === id);
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

  if (type === 'sale') {
    const list = root.querySelector('#sale-items');
    const addItem = (item) => { list.insertAdjacentHTML('beforeend', saleItemMarkup(item)); };
    (record ? saleItems(record) : [{}]).forEach(addItem);
    const updateAmount = () => {
      if (editing) return;
      const channel = root.querySelector('#field-channel').value;
      const total = [...list.querySelectorAll('.sale-item-row')].reduce((sum, row) => sum + productPrice(row.querySelector('.sale-product').value, channel) * Math.max(0, Number(row.querySelector('.sale-qty').value) || 0), 0);
      root.querySelector('#field-amount').value = total ? total.toFixed(2).replace(/\.00$/, '') : '';
    };
    root.querySelector('#add-sale-item').onclick = () => { addItem({}); updateAmount(); };
    list.onclick = (event) => { if (event.target.closest('.remove-sale-item') && list.querySelectorAll('.sale-item-row').length > 1) { event.target.closest('.sale-item-row').remove(); updateAmount(); } };
    list.onchange = updateAmount;
    list.oninput = updateAmount;
    root.querySelector('#field-channel').onchange = updateAmount;
  }

  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-close').onclick = close;
  root.querySelector('.modal-cancel').onclick = close;
  modal.onsubmit = (event) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(modal));
    if (type === 'sale') {
      const items = [...modal.querySelectorAll('.sale-item-row')].map((row) => ({ product: row.querySelector('.sale-product').value, qty: Number(row.querySelector('.sale-qty').value) })).filter((item) => item.product && item.qty > 0);
      if (!items.length) return;
      value.id = editing ? record.id : Date.now();
      value.amount = Number(value.amount);
      value.items = items;
      value.shipped = value.shipped === 'true';
      if (editing) Object.assign(record, value); else state.sales.unshift(value);
    }
    if (type === 'product') {
      value.price = Number(value.price);
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
toggleSalesCustomRange();
toggleExpenseCustomRange();
renderAll();
initialiseCloud();

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
