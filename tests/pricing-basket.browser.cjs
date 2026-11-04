const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('basket totals, quantities, removal and background rendering work on mobile, laptop and 4K', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440, 2560, 3840]) {
      const page = await browser.newPage({ viewport: { width, height: width === 3840 ? 2160 : 1000 }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
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
        state.products = [
          { id: 1, name: 'Organizer', price: 40, channelPrices: { Vinted: 50 }, weightGrams: 100, printHours: 0, filamentPrice: 100 },
          { id: 2, name: 'Stojak', price: 30, weightGrams: 50, printHours: 0, filamentPrice: 100 }
        ];
        renderAll();
      });
      const layout = await page.evaluate(() => {
        const main = document.querySelector('.main-content').getBoundingClientRect();
        return { right: main.right, width: main.width, overflow: document.documentElement.scrollWidth > innerWidth, padding: getComputedStyle(document.querySelector('.main-content')).paddingLeft };
      });
      assert.equal(layout.overflow, false, `no page overflow at ${width}`);
      assert.ok(Math.abs(layout.right - width) < 2, `uses available width at ${width}`);
      if (width === 1440) assert.equal(layout.padding, '48px');
      if (width === 390) assert.equal(layout.padding, '16px');
      if (width === 3840) await page.screenshot({ path: '/tmp/forma-dashboard-4k.png' });
      await page.evaluate(() => { document.querySelector('[data-view="inventory"]').click(); showInventoryTab('calculator'); });
      await page.locator('#pricing-channel').selectOption('Vinted');
      assert.equal(await page.locator('#pricing-offer').inputValue(), '50.00');
      await page.locator('#pricing-add-item').click();
      await page.locator('.pricing-item select').nth(1).selectOption('2');
      await page.locator('.pricing-item input').first().fill('2');
      assert.equal(await page.locator('#pricing-offer').inputValue(), '130.00');
      await page.locator('#pricing-extra').fill('5');
      await page.locator('#pricing-fee').fill('10');
      await page.locator('#pricing-offer').fill('100');
      assert.match(await page.locator('.pricing-floor strong').innerText(), /75,00/);
      assert.match(await page.locator('.pricing-numbers').innerText(), /60,00/);
      assert.match(await page.locator('.pricing-numbers').innerText(), /60%/);
      await page.evaluate(() => renderAll());
      assert.equal(await page.locator('.pricing-item').count(), 2);
      assert.equal(await page.locator('.pricing-item input').first().inputValue(), '2');
      assert.equal(await page.locator('#pricing-offer').inputValue(), '100');
      const calculatorOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(calculatorOverflow, false);
      if (width === 3840 || width === 390) await page.screenshot({ path: `/tmp/forma-calculator-${width}.png`, fullPage: true });
      await page.locator('.pricing-item input').first().fill('1.5');
      assert.match(await page.locator('#pricing-results').innerText(), /całkowitą/);
      await page.locator('.pricing-item input').first().fill('2');
      await page.locator('.pricing-item button').nth(1).click();
      assert.equal(await page.locator('.pricing-item').count(), 1);
      assert.equal(await page.locator('#pricing-offer').inputValue(), '100.00');
      await page.locator('.pricing-item button').first().click();
      assert.equal(await page.locator('.pricing-item').count(), 1);
      assert.equal(await page.locator('.pricing-item input').inputValue(), '1');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
