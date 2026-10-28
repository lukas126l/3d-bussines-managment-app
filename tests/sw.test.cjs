const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const events = {};
  const entries = new Map();
  const deleted = [];
  const calls = [];
  let offline = false;
  let status = 200;
  let claimed = false;
  const key = (request) => typeof request === 'string' ? request : request.url;
  const cache = {
    match: async (request) => entries.get(key(request)),
    put: async (request, response) => entries.set(key(request), response),
    addAll: async () => {},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), {
    URL,
    self: {
      registration: { scope: 'https://example.com/app/' },
      addEventListener: (name, handler) => { events[name] = handler; },
      skipWaiting() {},
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async () => cache,
      keys: async () => ['forma-3d-v23', 'forma-3d-v24', 'forma-3d-v25', 'forma-3d-v26', 'forma-3d-v27', 'forma-3d-v28', 'forma-3d-v29', 'forma-3d-v30', 'forma-3d-v31', 'forma-3d-v32', 'another-app'],
      delete: async (name) => { deleted.push(name); return true; },
    },
    fetch: async (request, options) => {
      calls.push({ request, options });
      if (offline) throw new Error('offline');
      return new Response('fresh', { status });
    },
  });
  return {
    entries, deleted, calls,
    offline() { offline = true; },
    status(value) { status = value; },
    async activate() {
      let work;
      events.activate({ waitUntil: (promise) => { work = promise; } });
      await work;
      assert.equal(claimed, true);
    },
    request(url, mode = 'cors', method = 'GET') {
      let result;
      events.fetch({ request: { url, mode, method }, respondWith: (promise) => { result = promise; } });
      return result;
    },
  };
}

test('API, external scripts, unknown paths and writes bypass the cache', () => {
  const app = setup();
  for (const url of ['https://project.supabase.co/rest/v1/forma_state', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', 'https://example.com/app/api']) {
    app.entries.set(url, new Response('stale'));
    assert.equal(app.request(url), undefined);
  }
  assert.equal(app.request('https://example.com/app/', 'cors', 'POST'), undefined);
});

test('app assets use fresh network responses and refresh their offline copy', async () => {
  const app = setup();
  const url = 'https://example.com/app/app.js';
  app.entries.set(url, new Response('stale'));
  assert.equal(await (await app.request(url)).text(), 'fresh');
  assert.equal(app.calls[0].options.cache, 'no-store');
  app.offline();
  assert.equal(await (await app.request(url)).text(), 'fresh');
});

test('HTML fallback is only returned for document navigation', async () => {
  const app = setup();
  app.entries.set('./index.html', new Response('<html>offline</html>'));
  app.offline();
  assert.equal(await (await app.request('https://example.com/app/?launch=1', 'navigate')).text(), '<html>offline</html>');
  await assert.rejects(app.request('https://example.com/app/app.js'), /offline/);
});

test('HTTP errors do not replace a valid cached asset', async () => {
  const app = setup();
  const url = 'https://example.com/app/app.js';
  app.entries.set(url, new Response('working'));
  app.status(503);
  assert.equal((await app.request(url)).status, 503);
  assert.equal(await app.entries.get(url).text(), 'working');
});

test('activation removes old application caches but preserves unrelated caches', async () => {
  const app = setup();
  await app.activate();
  assert.deepEqual(app.deleted, ['forma-3d-v23', 'forma-3d-v24', 'forma-3d-v25', 'forma-3d-v26', 'forma-3d-v27', 'forma-3d-v28', 'forma-3d-v29', 'forma-3d-v30', 'forma-3d-v31']);
});
