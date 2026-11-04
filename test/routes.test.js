const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { keyPrefix } = require('../server/cache/config');
const prefix = keyPrefix('test');
const calls = [];
let lookup = null;
let remainingTtl = -2;
let fail = false;
const redis = {
  async mGet() { if (fail) throw new Error('Redis unavailable'); return ['1', '2', '3', '4']; },
  async incr(name) { calls.push(['incr', name]); return 2; },
  async set(name, value) { calls.push(['set', name, value]); return 'OK'; },
  async zRange(name) { calls.push(['zRange', name]); return [prefix + 'demo:greeting']; },
  async zRemRangeByScore(name) { calls.push(['prune', name]); return 0; },
  async zRangeWithScores() { return [{ value: 'Sample player', score: 42 }]; },
  multi() {
    const queued = [];
    const transaction = {
      get(name) { queued.push(['get', name]); return transaction; },
      ttl(name) { queued.push(['ttl', name]); return transaction; },
      set(name, value, options) { queued.push(['set', name, value, options]); return transaction; },
      zAdd(name, value) { queued.push(['zAdd', name, value]); return transaction; },
      del(names) { queued.push(['del', names]); return transaction; },
      async exec() {
        calls.push(...queued);
        return queued.map(([command]) => command === 'get' ? lookup : command === 'ttl' ? remainingTtl : command === 'del' ? 1 : 'OK');
      },
    };
    return transaction;
  },
};
const cachePath = require.resolve('../server/cache');
require.cache[cachePath] = { id: cachePath, filename: cachePath, loaded: true, exports: { redis, key: suffix => prefix + suffix } };
let server;
let origin;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/counters', require('../server/routes/counters'));
  app.use('/api/leaderboard', require('../server/routes/leaderboard'));
  app.use('/api/cache-demo', require('../server/routes/cacheDemo'));
  app.use(require('../server/middleware/errorHandler'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('cache rejects invalid keys, non-string values and invalid TTL rather than coercing', async () => {
  for (const body of [
    { key: '*', value: 'test', ttl: 60 },
    { key: {}, value: 'test', ttl: 60 },
    { key: 'safe', value: {}, ttl: 60 },
    { key: 'safe', value: 'test', ttl: 0 },
    { key: 'safe', value: 'test', ttl: '60' },
    { key: 'safe', value: 'test', ttl: 3601 },
  ]) assert.equal((await request('/api/cache-demo/set', body)).status, 400);
});

test('cache writes namespaced expiring keys and registry in the same transaction', async () => {
  calls.length = 0;
  const result = await request('/api/cache-demo/set', { key: 'safe', value: 'test', ttl: 60 });
  assert.equal(result.status, 200);
  assert.equal(result.data.key, prefix + 'demo:safe');
  assert.ok(calls.some(([command, name, , options]) => command === 'set' && name === prefix + 'demo:safe' && options.EX === 60));
  assert.ok(calls.some(([command, name]) => command === 'zAdd' && name === prefix + 'demo-keys'));
});

test('GET distinguishes hits from expired misses and counts hits only', async () => {
  calls.length = 0;
  lookup = 'cached';
  remainingTtl = 20;
  assert.deepEqual((await request('/api/cache-demo/get/safe')).data, { key: prefix + 'demo:safe', hit: true, value: 'cached', ttl: 20 });
  assert.ok(calls.some(([command, name]) => command === 'incr' && name === prefix + 'counter:cache_hits'));
  calls.length = 0;
  lookup = null;
  remainingTtl = -2;
  assert.equal((await request('/api/cache-demo/get/safe')).data.hit, false);
  assert.ok(!calls.some(([command]) => command === 'incr'));
});

test('flush deletes only indexed demonstration keys and their registry', async () => {
  calls.length = 0;
  assert.equal((await request('/api/cache-demo/flush', {})).status, 200);
  const deleted = calls.filter(([command]) => command === 'del').flatMap(([, keys]) => keys);
  assert.deepEqual(deleted, [prefix + 'demo:greeting', prefix + 'demo-keys']);
});

test('counters retain output shape and reject unknown mutation targets', async () => {
  assert.deepEqual((await request('/api/counters')).data, { page_views: 1, api_calls: 2, cache_hits: 3, errors: 4 });
  assert.equal((await request('/api/counters/unknown/increment', {})).status, 400);
});

test('backend failures remain errors and do not expose internal exception details', async () => {
  fail = true;
  try {
    const result = await request('/api/counters');
    assert.equal(result.status, 500);
    assert.match(result.data.error, /operation failed/);
    assert.ok(!result.data.error.includes('Redis unavailable'));
  } finally { fail = false; }
});

test('leaderboard output retains rank/name/score and validates inputs', async () => {
  assert.deepEqual((await request('/api/leaderboard')).data, [{ rank: 1, name: 'Sample player', score: 42 }]);
  assert.equal((await request('/api/leaderboard?limit=-1')).status, 400);
  assert.equal((await request('/api/leaderboard', { name: 'Test', score: 'not-number' })).status, 400);
});
