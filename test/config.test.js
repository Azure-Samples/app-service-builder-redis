const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readConfig, keyPrefix } = require('../server/cache/config');

test('requires explicit endpoint and disallows credentials, URLs and invalid ports', () => {
  for (const endpoint of [undefined, 'redis://localhost:6379', 'rediss://token@cache:10000', 'cache', 'cache:0', 'cache:65536']) {
    assert.throws(() => readConfig({ REDIS_ENDPOINT: endpoint }));
  }
});

test('defaults to system managed identity and a cluster-safe namespace', () => {
  const config = readConfig({ REDIS_ENDPOINT: 'sample.eastus.redis.azure.net:10000' });
  assert.equal(config.mode, 'managed-identity');
  assert.equal(config.clientId, undefined);
  assert.equal(keyPrefix(config.namespace), 'pulseboard:{demo}:');
});

test('accepts explicit local developer and user assigned identity configuration', () => {
  assert.equal(readConfig({ REDIS_ENDPOINT: 'sample:10000', REDIS_AUTH_MODE: 'developer' }).mode, 'developer');
  assert.equal(readConfig({ REDIS_ENDPOINT: 'sample:10000', AZURE_CLIENT_ID: 'user-identity-client' }).clientId, 'user-identity-client');
});

test('rejects namespace injection and hosted developer credential fallback', () => {
  for (const namespace of ['*', 'a}:*', '', 'a'.repeat(41), 'a:b']) {
    assert.throws(() => readConfig({ REDIS_ENDPOINT: 'sample:10000', REDIS_NAMESPACE: namespace }));
  }
  assert.throws(() => readConfig({ REDIS_ENDPOINT: 'sample:10000', REDIS_AUTH_MODE: 'keys' }));
  assert.throws(() => readConfig({ REDIS_ENDPOINT: 'sample:10000', REDIS_AUTH_MODE: 'developer', IDENTITY_ENDPOINT: 'http://identity' }));
});
