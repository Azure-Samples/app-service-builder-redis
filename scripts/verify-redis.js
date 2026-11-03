const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');
const { createConnection } = require('../server/cache/connection');
const { readConfig, keyPrefix } = require('../server/cache/config');

async function verify() {
  const config = readConfig();
  const baseCredential = config.mode === 'developer'
    ? new DefaultAzureCredential()
    : new ManagedIdentityCredential(config.clientId ? { clientId: config.clientId } : {});
  let acquisitions = 0;
  let refreshes = 0;
  const credential = {
    async getToken(scopes, options) {
      const token = await baseCredential.getToken(scopes, options);
      assert.ok(token, 'Entra must return a token');
      acquisitions++;
      // Accelerate SDK scheduling only. The real signed Entra token is unmodified.
      return { ...token, expiresOnTimestamp: Date.now() + 20000 };
    },
  };
  let { redis } = createConnection({ config, credential, observeRefresh: () => refreshes++ });
  let acknowledgedAuth = 0;
  const prefix = keyPrefix(config.namespace);
  const id = randomUUID();
  const keys = ['value', 'counter', 'leaderboard'].map(suffix => `${prefix}verify:${id}:${suffix}`);
  try {
    await redis.connect();
    assert.equal(await redis.ping(), 'PONG');
    assert.equal(await redis.set(keys[0], 'real Azure Redis', { EX: 60 }), 'OK');
    assert.equal(await redis.get(keys[0]), 'real Azure Redis');
    assert.ok(await redis.ttl(keys[0]) > 0);
    assert.equal(await redis.incr(keys[1]), 1);
    await redis.multi().zAdd(keys[2], { score: 10, value: 'Sample player' }).incr(keys[1]).exec();
    assert.equal(await redis.zIncrBy(keys[2], 5, 'Sample player'), 15);
    assert.deepEqual(await redis.zRangeWithScores(keys[2], 0, -1, { REV: true }), [{ value: 'Sample player', score: 15 }]);
    await assert.rejects(redis.get('outside-pulseboard-namespace'), /NOPERM|permission/i);
    for (const master of redis.masters) {
      const node = await redis.nodeClient(master);
      // node-redis's public client is Object.create(transport); observe the pinned
      // transport method so the provider callback's successful AUTH is counted.
      const transport = Object.getPrototypeOf(node);
      const reAuthenticate = transport.reAuthenticate.bind(transport);
      transport.reAuthenticate = async credentials => {
        await reAuthenticate(credentials);
        acknowledgedAuth++;
      };
    }
    for (let i = 0; i < 24; i++) {
      await sleep(1000);
      assert.equal(await redis.get(keys[0]), 'real Azure Redis');
    }
    assert.ok(acquisitions >= 2, 'Token manager must reacquire credentials automatically');
    assert.ok(refreshes >= 1, 'Streaming provider must deliver refreshed credentials');
    assert.ok(acknowledgedAuth >= redis.masters.length, 'Each open master connection must acknowledge renewed AUTH');
    redis.destroy();
    ({ redis } = createConnection({ config, credential }));
    await redis.connect();
    assert.equal(await redis.get(keys[0]), 'real Azure Redis');
    await redis.set(keys[0], 'expires', { EX: 1 });
    await sleep(1500);
    assert.equal(await redis.get(keys[0]), null);
    assert.equal(await redis.ttl(keys[0]), -2);
    console.log(JSON.stringify({
      result: 'passed', topology: 'OSSCluster', authentication: config.mode,
      tls: true, acquisitions, refreshNotifications: refreshes,
      serverAuthAcknowledgements: acknowledgedAuth,
      checks: ['set/get', 'TTL expiry', 'counter', 'leaderboard', 'same-slot transaction', 'namespace denial', 'automatic re-authentication', 'fresh connection with renewed credentials'],
      renewalEvidence: '20-second client expiration metadata; real signed token unchanged (not a full natural-token-expiry soak)',
    }, null, 2));
  } finally {
    try {
      if (redis.isReady) await redis.del(keys);
    } finally {
      if (redis.isOpen) redis.destroy();
    }
  }
}

verify().catch(err => {
  console.error('Redis verification failed:', err.message);
  process.exitCode = 1;
});
