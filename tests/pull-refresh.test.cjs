const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function setup() {
  const events = {};
  const classes = new Set();
  const label = { textContent: '' };
  const indicator = {
    setAttribute() {}, style: { setProperty() {} },
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
    querySelector: s => s === 'span' ? label : { style: {} },
  };
  const shell = { hidden: false }, modal = { firstElementChild: null }, button = { disabled: false };
  let refreshes = 0;
  const window = { scrollY: 0 };
  const context = vm.createContext({
    window, document: { body: { append() {} }, createElement: () => indicator, querySelector: s => ({ '#app-shell': shell, '#modal-root': modal, '#check-updates': button }[s]), addEventListener: (name, fn) => { events[name] = fn; } },
    clearTimeout() {}, setTimeout() {}, getComputedStyle: () => ({ overflowY: 'visible' }),
    refreshApplication: async () => { refreshes++; return true; },
  });
  vm.runInContext(source.slice(source.indexOf('function initialisePullRefresh()')), context);
  const touch = (y, x = 0) => ({ touches: [{ clientX: x, clientY: y }], target: { closest: () => false }, cancelable: true, preventDefault() {} });
  return { events, touch, modal, window, classes, count: () => refreshes };
}
test('deliberate pull refreshes once after release; short pull cancels', async () => {
  const a = setup();
  a.events.touchstart(a.touch(0)); a.events.touchmove(a.touch(90)); await a.events.touchend();
  assert.equal(a.count(), 0);
  a.events.touchstart(a.touch(0)); a.events.touchmove(a.touch(180));
  assert.equal(a.classes.has('is-ready'), true);
  await a.events.touchend(); await a.events.touchend();
  assert.equal(a.count(), 1);
  assert.equal(a.classes.has('is-loading'), true);
});
test('scrolling, horizontal swipes, open forms and cancelled touches never refresh', async () => {
  for (const mode of ['scrolled', 'horizontal', 'modal', 'cancelled']) {
    const a = setup();
    if (mode === 'scrolled') a.window.scrollY = 100;
    if (mode === 'modal') a.modal.firstElementChild = {};
    a.events.touchstart(a.touch(0));
    a.events.touchmove(a.touch(180, mode === 'horizontal' ? 250 : 0));
    if (mode === 'cancelled') a.events.touchcancel();
    await a.events.touchend();
    assert.equal(a.count(), 0, mode);
  }
});
