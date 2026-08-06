import assert from 'node:assert/strict';
import test from 'node:test';
import { IndexResponseCache } from './index-cache.mjs';

function response(value) {
  return { status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify({ value })) };
}

test('coalesces cold requests and serves a fresh hit', async () => {
  let calls = 0;
  const cache = new IndexResponseCache({ fetcher: async () => { calls += 1; return response(calls); } });
  const [first, second] = await Promise.all([cache.get('/index'), cache.get('/index')]);
  assert.equal(calls, 1);
  assert.equal(first.status, 'MISS');
  assert.equal(second.status, 'MISS');
  assert.equal((await cache.get('/index')).status, 'HIT');
});

test('serves stale immediately and coalesces background refreshes', async () => {
  let now = 0;
  let calls = 0;
  let releaseRefresh;
  const cache = new IndexResponseCache({
    now: () => now,
    ttlMs: 100,
    maxStaleMs: 1000,
    fetcher: async () => {
      calls += 1;
      if (calls === 2) await new Promise((resolve) => { releaseRefresh = resolve; });
      return response(calls);
    }
  });
  await cache.get('/index');
  now = 200;
  const firstStale = await cache.get('/index');
  const secondStale = await cache.get('/index');
  assert.equal(firstStale.status, 'STALE');
  assert.equal(secondStale.status, 'STALE');
  assert.equal(calls, 2);
  releaseRefresh();
  await cache.pending.get('/index');
  assert.equal((await cache.get('/index')).status, 'HIT');
});

test('discards entries older than the maximum stale window', async () => {
  let now = 0;
  let calls = 0;
  const cache = new IndexResponseCache({
    now: () => now,
    ttlMs: 100,
    maxStaleMs: 1000,
    fetcher: async () => { calls += 1; return response(calls); }
  });
  await cache.get('/index');
  now = 1001;
  const result = await cache.get('/index');
  assert.equal(result.status, 'MISS');
  assert.equal(calls, 2);
});

test('keeps stale data when a background refresh fails', async () => {
  let now = 0;
  let calls = 0;
  const cache = new IndexResponseCache({
    now: () => now,
    ttlMs: 100,
    maxStaleMs: 1000,
    fetcher: async () => {
      calls += 1;
      if (calls > 1) throw new Error('upstream unavailable');
      return response(1);
    }
  });
  await cache.get('/index');
  now = 200;
  assert.equal((await cache.get('/index')).status, 'STALE');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.entries.has('/index'), true);
});
