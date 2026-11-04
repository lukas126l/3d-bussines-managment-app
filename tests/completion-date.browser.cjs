const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('completion records a separate date and recognizes previous-month orders this month', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'forma.test') return route.abort();
        const file = path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname);
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      });
      await page.goto('http://forma.test/');
      const dates = await page.evaluate(() => {
        const today = localDateToday();
        const current = new Date();
        current.setDate(1); current.setMonth(current.getMonth() - 1);
        const previous = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-15`;
        document.querySelector('#auth-screen').hidden = true;
        document.querySelector('#app-shell').hidden = false;
        state.sales = [{id: 42, date: previous, status:'shipped', amount:100, channel:'Etsy', sellingCosts:0, items:[{product:state.products[0].name, qty:1, unitCost:10}]}];
        state.expenses = [];
        renderAll();
        openModal('sale',42);
        return {today, previous};
      });
      assert.equal(await page.locator('#field-completedDate').isVisible(), false);
      await page.locator('#field-status').selectOption('done');
      assert.equal(await page.locator('#field-completedDate').inputValue(), dates.today);
      await page.getByRole('button', {name:'Zapisz',exact:true}).click();
      assert.equal(await page.evaluate(() => state.sales[0].date), dates.previous);
      assert.equal(await page.evaluate(() => state.sales[0].completedDate), dates.today);
      assert.equal(await page.locator('#metric-revenue').textContent(), '100 zł');
      assert.equal(await page.locator('#metric-profit').textContent(), '100 zł');
      assert.match(await page.locator('#analysis-sales-profit').textContent(), /90,00/);
      const revenueBars = await page.locator('#chart .bar.revenue').evaluateAll(bars => bars.map(b => b.style.height));
      assert.equal(revenueBars.at(-1), '100%');
      assert.equal(revenueBars.at(-2), '3%');
      await page.evaluate(() => openModal('sale',42));
      assert.equal(await page.locator('#field-completedDate').inputValue(), dates.today);
      await page.locator('#field-completedDate').fill(dates.previous);
      await page.getByRole('button', {name:'Zapisz',exact:true}).click();
      assert.equal(await page.locator('#metric-revenue').textContent(), '0 zł');
      assert.equal(await page.evaluate(() => getAnalysisSales().length), 0);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(storeKey)).sales[0].completedDate), dates.previous);
      await page.close();
    }
  } finally { await browser.close(); }
});
