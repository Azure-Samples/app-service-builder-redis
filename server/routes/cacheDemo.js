const router = require('express').Router();
const { redis, key } = require('../cache');
const registry = key('demo-keys');

function demoKey(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(name)) {
    const error = new Error('key must be 1-100 letters, digits, dots, underscores, colons or hyphens');
    error.status = 400;
    throw error;
  }
  return key('demo:' + name);
}

async function liveKeys() {
  await redis.zRemRangeByScore(registry, '-inf', Date.now());
  return redis.zRange(registry, 0, -1);
}

router.post('/set', async (req, res, next) => {
  try {
    const { key: name, value, ttl = 60 } = req.body;
    const safeKey = demoKey(name);
    if (typeof value !== 'string' || value.length < 1 || value.length > 1000) {
      return res.status(400).json({ error: 'value must be 1-1000 characters' });
    }
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
      return res.status(400).json({ error: 'ttl must be an integer from 1 to 3600' });
    }
    const keys = await liveKeys();
    if (keys.length >= 50 && !keys.includes(safeKey)) {
      return res.status(409).json({ error: 'Demo key limit reached; wait for expiry or flush demo keys' });
    }
    await redis.multi()
      .set(safeKey, value, { EX: ttl })
      .zAdd(registry, { score: Date.now() + ttl * 1000, value: safeKey })
      .exec();
    res.json({ key: safeKey, value, ttl });
  } catch (err) { next(err); }
});

router.get('/get/:key', async (req, res, next) => {
  try {
    const safeKey = demoKey(req.params.key);
    const [value, ttl] = await redis.multi().get(safeKey).ttl(safeKey).exec();
    if (value === null) return res.json({ key: safeKey, hit: false, value: null, ttl });
    await redis.incr(key('counter:cache_hits'));
    res.json({ key: safeKey, hit: true, value, ttl });
  } catch (err) { next(err); }
});

router.get('/keys', async (req, res, next) => {
  try {
    const keys = await liveKeys();
    const entries = await Promise.all(keys.slice(0, 50).map(async (safeKey) => {
      const [value, ttl] = await redis.multi().get(safeKey).ttl(safeKey).exec();
      return { key: safeKey, name: safeKey.slice(key('demo:').length), value, ttl };
    }));
    res.json(entries.filter(entry => entry.value !== null));
  } catch (err) { next(err); }
});

router.post('/flush', async (req, res, next) => {
  try {
    const keys = await liveKeys();
    // Delete only indexed sample keys; never KEYS, SCAN, FLUSHDB or FLUSHALL.
    const validKeys = keys.filter(name => name.startsWith(key('demo:')));
    const transaction = redis.multi();
    if (validKeys.length) transaction.del(validKeys);
    transaction.del(registry);
    const result = await transaction.exec();
    res.json({ flushed: validKeys.length ? result[0] : 0 });
  } catch (err) { next(err); }
});

module.exports = router;
