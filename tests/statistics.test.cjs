const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const s=fs.readFileSync(require.resolve('../app.js'),'utf8');
const ctx=vm.createContext({});
for(const [a,b] of [['function saleItems(', '// Costs are stored'],['function saleRecognitionDate(', 'function localDateToday('],['function salesMonthStats(', 'function renderSalesStatistics(']]) vm.runInContext(s.slice(s.indexOf(a),s.indexOf(b)),ctx);
test('statistics separate order and completion months and exclude cancellations',()=>{
 const sales=[
 {date:'2026-10-30',completedDate:'2026-11-01',status:'done',amount:100,items:[{qty:2}]},
 {date:'2026-11-02',status:'processing',amount:60,items:[{qty:3}]},
 {date:'2026-11-02',status:'done',amount:40,product:'Legacy',qty:1},
 {date:'2026-11-02',status:'cancelled',amount:999,items:[{qty:99}]}
 ];
 const r=ctx.salesMonthStats(sales,'2026-11');
 assert.equal(r.orders,2);assert.equal(r.units,4);assert.equal(r.value,100);
 assert.equal(r.completed,140);assert.equal(r.legacy,1);assert.equal(r.days[1].count,2);
 assert.equal(r.days.length,30);
 assert.equal(ctx.salesMonthStats([], '2024-02').days.length,29);
 assert.equal(ctx.salesMonthStats([], '2026-12').value,0);
});
test('custom dates include both boundaries and separate completion from order dates',()=>{
 const sales=[{date:'2026-10-31',completedDate:'2026-11-02',status:'done',amount:100,qty:2,product:'A'},{date:'2026-11-03',status:'new',amount:50,qty:1,product:'B'}];
 const r=ctx.salesMonthStats(sales,'2026-11','2026-10-31','2026-11-02');
 assert.equal(r.orders,1);assert.equal(r.value,100);assert.equal(r.completed,100);assert.equal(r.days.length,3);assert.equal(r.days[0].day,'31.10');
});
