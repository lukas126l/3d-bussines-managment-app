const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('order and settlement periods, confirmed costs and local month rollover stay consistent', async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  for (const width of [390,1440]) {
   const page = await browser.newPage({viewport:{width,height:1000},timezoneId:'Europe/Warsaw',serviceWorkers:'block'});
   await page.clock.install({time:new Date('2026-11-30T22:30:00Z')});
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'forma.test') return route.abort();
        const file = path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname);
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      });
      await page.goto('http://forma.test/');

   await page.evaluate(() => {
    document.querySelector('#auth-screen').hidden=true;document.querySelector('#app-shell').hidden=false;
    state.products=[{id:1,name:'Test',price:100,weightGrams:100,printHours:0,filamentPrice:100}];
    state.channels=[{id:1,name:'Etsy',symbol:'E'}];state.expenses=[{id:1,name:'Materiał',category:'Materiały',date:'2026-11-01',amount:5}];
    state.sales=[
     {id:1,date:'2026-10-15',completedDate:'2026-11-04',status:'done',channel:'Etsy',amount:100,items:[{product:'Test',qty:2,unitCost:10}]},
     {id:2,date:'2026-11-01',status:'cancelled',channel:'Etsy',amount:500,items:[{product:'Test',qty:7,unitCost:10}]},
     {id:3,date:'2026-11-02',status:'new',channel:'Etsy',amount:50,items:[{product:'Test',qty:1}]},
     {id:4,date:'2026-10-10',completedDate:'2026-10-20',status:'done',channel:'Etsy',amount:100,items:[{product:'Test',qty:1}]}
    ];renderAll();document.querySelector('[data-view="sales"]').click();
   });
   assert.equal(await page.evaluate(()=>iso(now)),'2026-11-30');
   assert.equal(await page.locator('#metric-units').textContent(),'2');
   assert.equal(await page.locator('#analysis-units').textContent(),'2');
   assert.equal(await page.locator('#analysis-orders').textContent(),'1');
   assert.match(await page.locator('#analysis-sales-value').textContent(),/50,00/);
   assert.match(await page.locator('#analysis-revenue').textContent(),/100,00/);
   assert.match(await page.locator('#metric-profit').textContent(),/95/);
   assert.match(await page.locator('#analysis-sales-profit').textContent(),/80,00/);
   assert.deepEqual(await page.evaluate(()=>getFilteredSales().map(s=>s.id)),[3,2]);
   await page.locator('#sales-list-basis').selectOption('settled');
   assert.deepEqual(await page.evaluate(()=>getFilteredSales().map(s=>s.id)),[1]);
   await page.locator('#sales-analysis-range').selectOption('calendar-month:2026-10');
   assert.deepEqual(await page.evaluate(()=>getFilteredSales().map(s=>s.id)),[4]);
   assert.match(await page.locator('#analysis-sales-margin-note').textContent(),/Wynik szacunkowy/);
   await page.evaluate(()=>openModal('sale',4));
   await page.getByRole('button',{name:'Zapisz',exact:true}).click();
   assert.equal(await page.evaluate(()=>state.sales.find(s=>s.id===4).items[0].unitCost),null);
   await page.evaluate(()=>openModal('sale',4));
   await page.locator('.historical-unit-cost').fill('25');
   await page.locator('#confirm-historical-costs').check();
   await page.getByRole('button',{name:'Zapisz',exact:true}).click();
   assert.equal(await page.evaluate(()=>state.sales.find(s=>s.id===4).items[0].unitCost),25);
   await page.evaluate(()=>{state.products[0].filamentPrice=300;renderAll();});
   assert.match(await page.locator('#analysis-sales-profit').textContent(),/75,00/);
   assert.doesNotMatch(await page.locator('#analysis-sales-margin-note').textContent(),/Wynik szacunkowy/);
   await page.locator('#sales-analysis-range').selectOption('month');
   await page.clock.setSystemTime(new Date('2026-12-01T00:30:00Z'));
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   assert.equal(await page.evaluate(()=>iso(now)),'2026-12-01');
   assert.equal(await page.locator('#metric-units').textContent(),'0');
   assert.match(await page.locator('#sidebar-month').textContent(),/Grudzień/);
   assert.equal(await page.evaluate(()=>valueFor('date',null)),'2026-12-01');
   await page.close();
  }
 } finally {await browser.close();}
});
