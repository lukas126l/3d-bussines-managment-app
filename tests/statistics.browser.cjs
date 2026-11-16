const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('statistics tab preserves month and separates completed totals on desktop and mobile', async () => {
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
        document.querySelector('#auth-screen').hidden=false;
        document.querySelector('#auth-screen').hidden=true;
        document.querySelector('#app-shell').hidden=false;
        state.sales=[
          {date:'2026-10-31',completedDate:'2026-11-02',status:'done',amount:100,product:'Test',qty:2},
          {date:'2026-11-05',status:'new',amount:50,product:'Test',qty:3}
        ];
        renderAll();
        document.querySelector('[data-view="sales"]').click();
      });
      await page.locator('[data-sales-tab="statistics"]').click();
      await page.locator('#statistics-month').fill('2026-11');
      await page.locator('#statistics-month').dispatchEvent('change');
      assert.equal(await page.locator('#sales-list-panel').isVisible(),false);
      const values=await page.locator('#statistics-summary strong').allTextContents();
      assert.equal(values[0],'1');assert.equal(values[1],'3');
      assert.match(values[2],/50/);assert.match(values[3],/100/);
      assert.equal(await page.locator('.daily-bars .statistics-column').count(),30);
      assert.equal(await page.locator('.monthly-bars .statistics-column').count(),12);
      await page.evaluate(()=>renderAll());
      assert.equal(await page.locator('#statistics-month').inputValue(),'2026-11');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      await page.locator('[data-sales-tab="list"]').click();
      assert.equal(await page.locator('#sales-list-panel').isVisible(),true);
      await page.close();
    }
  } finally { await browser.close(); }
});
