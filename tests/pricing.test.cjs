const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function calculatePriceFloor('),source.indexOf('function showInventoryTab(')),context);
const calculate=context.calculatePriceFloor;
test('minimum price preserves a margin on revenue rather than markup on cost',()=>{
 const result=calculate(20,50,0,0,40);
 assert.equal(result.minimum,40);
 assert.equal(result.profit,20);
 assert.equal(result.margin,50);
 assert.equal(result.acceptable,true);
 assert.equal(calculate(20,50,0,0,39.99).acceptable,false);
});
test('fixed selling costs and percentage fees count in the floor and offer',()=>{
 const result=calculate(20,50,5,10,62.5);
 assert.equal(result.minimum,62.5);
 assert.equal(result.profit,31.25);
 assert.equal(result.margin,50);
 assert.equal(result.breakEven,27.78);
});
test('floor rounds up to a cent and covers zero price, loss and invalid margins',()=>{
 const result=calculate(11.2,70,0,0,37.34);
 assert.equal(result.minimum,37.34);
 assert.ok(result.margin>=70);
 assert.equal(calculate(20,0,0,0,10).profit,-10);
 assert.equal(calculate(20,50,0,0,0).margin,null);
 assert.equal(calculate(20,90,0,10,100),null);
 assert.equal(calculate(null,50),null);
 assert.equal(calculate(20,-1),null);
 assert.equal(calculate(20,NaN),null);
});
