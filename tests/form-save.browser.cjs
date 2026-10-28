// Run with Playwright installed: node --test tests/form-save.browser.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('one click saves each form after a background refresh, on desktop and mobile', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'forma.test') return route.abort();
        const file = path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname);
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      });
      await page.goto('http://forma.test/');
      await page.evaluate(() => {
        document.querySelector('#auth-screen').hidden = true;
        document.querySelector('#app-shell').hidden = false;
      });
      for (const [type, collection, field, value] of [
        ['product', 'products', 'price', '42'],
        ['sale', 'sales', 'amount', '123'],
        ['expense', 'expenses', 'amount', '12'],
        ['channel', 'channels', 'name', 'Nowa nazwa'],
      ]) {
        await page.evaluate((type) => openModal(type, 1), type);
        await page.locator(`#field-${field}`).fill(value);
        await page.evaluate(() => { state = JSON.parse(JSON.stringify(state)); });
        await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
        const result = await page.evaluate(({ collection, field }) => ({
          live: state[collection].find((entry) => entry.id === 1)[field],
          stored: JSON.parse(localStorage.getItem(storeKey))[collection].find((entry) => entry.id === 1)[field],
          open: !!document.querySelector('.modal'),
        }), { collection, field });
        assert.equal(String(result.live), value, `${type}, ${viewport.width}: first save`);
        assert.equal(String(result.stored), value);
        assert.equal(result.open, false);
      }
      // Details must be read-only and calculate old orders without persisting estimates.
      const before = await page.evaluate(() => {
        Object.assign(state.products.find((p) => p.id === 1), {weightGrams: 100, printHours: 3, filamentPrice: 80});
        renderAll();
        document.querySelector('[data-view="inventory"]').click();
        return JSON.stringify(state);
      });
      await page.locator('[data-view-product="1"]').click();
      assert.equal(await page.locator('.modal input, .modal select').count(), 0);
      assert.match(await page.locator('.detail-content').innerText(), /Marża: 76,7%/);
      await page.getByRole('button', {name: 'Zamknij', exact: true}).last().click();
      await page.evaluate(() => document.querySelector('[data-view="sales"]').click());
      await page.locator('[data-view-sale="1"]:visible').click();
      assert.equal(await page.locator('.modal input, .modal select').count(), 0);
      assert.match(await page.locator('.detail-content').innerText(), /Marża: 84,1%/);
      assert.doesNotMatch(await page.locator('.detail-content').innerText(), /Szacunek według aktualnych/);
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      await page.getByRole('button', {name: 'Edytuj', exact: true}).last().click();
      assert.equal(await page.locator('#field-amount').count(), 1);
      await page.getByRole('button', {name: 'Anuluj', exact: true}).click();
      await page.evaluate(() => {
        state.sales = [
          {id: 10, date: iso(now), status:'done', amount:100, channel:'Etsy', items:[{product:'Test',qty:1,unitCost:10}]},
          {id: 11, date: iso(now), status:'done', amount:900, channel:'Etsy', items:[{product:'Test',qty:1,unitCost:810}]}
        ];
        renderAll();
      });
      assert.equal(await page.locator('#monthly-sales-margin').textContent(), '18%');
      assert.equal(await page.locator('#analysis-sales-margin').textContent(), '18%');
      assert.doesNotMatch(await page.locator('#sales-table').innerText(), /Szacunek według aktualnych/);
      await page.close();
    }
  } finally { await browser.close(); }
});
