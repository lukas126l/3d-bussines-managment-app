const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('filament creation inside product, price changes and historical sales on desktop and mobile', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
      const page = await browser.newPage({viewport, serviceWorkers:'block'});
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'forma.test') return route.abort();
        const file = path.join(__dirname,'..',url.pathname === '/' ? 'index.html' : url.pathname);
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
      });
      await page.goto('https://forma.test/');
      await page.evaluate(() => {
        document.querySelector('#auth-screen').hidden=true;
        document.querySelector('#app-shell').hidden=false;
        openModal('product',1);
      });
      await page.locator('#field-weightGrams').fill('100');
      await page.locator('#field-printHours').fill('2');
      await page.locator('#inline-filament').click();
      await page.locator('#filament-name').fill('Test filament');
      await page.locator('#filament-type').selectOption('__new');
      await page.locator('#new-filament-type').fill('tpu');
      await page.locator('#filament-price').fill('80');
      await page.getByRole('button',{name:'Zapisz filament',exact:true}).click();
      assert.equal(await page.locator('#field-weightGrams').inputValue(),'100');
      await page.getByRole('button',{name:'Zapisz',exact:true}).click();
      assert.equal(await page.evaluate(() => productionCost(state.products[0])),9.2);
      await page.evaluate(() => {
        state.sales=[{id:99,items:[snapshotSaleItem(state.products[0].name,2)],amount:40}];
        openFilamentEditor(state.filaments[0].id);
      });
      await page.locator('#filament-price').fill('120');
      await page.getByRole('button',{name:'Zapisz filament',exact:true}).click();
      const result = await page.evaluate(() => ({
        cost:productionCost(state.products[0]),sale:state.sales[0].items[0],
        stored:JSON.parse(localStorage.getItem(storeKey)).filaments[0]
      }));
      assert.equal(result.cost,13.2);
      assert.equal(result.sale.unitCost,9.2);
      assert.equal(result.sale.material.price,80);
      assert.equal(result.stored.type,'TPU');
      await page.close();
    }
  } finally { await browser.close(); }
});
