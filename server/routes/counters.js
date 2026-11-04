const router = require('express').Router();
const { redis, key } = require('../cache');

const ALLOWED_COUNTERS = ['page_views', 'api_calls', 'cache_hits', 'errors'];

// Get all counters
router.get('/', async (req, res, next) => {
  try {
    const results = await redis.mGet(ALLOWED_COUNTERS.map(c => key('counter:' + c)));
    const counters = {};
    ALLOWED_COUNTERS.forEach((name, i) => {
      if (results[i] === null || !Number.isSafeInteger(Number(results[i]))) {
        throw new Error('Counter missing or invalid: ' + name);
      }
      counters[name] = Number(results[i]);
    });
    res.json(counters);
  } catch (err) { next(err); }
});

// Increment a counter
router.post('/:name/increment', async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!ALLOWED_COUNTERS.includes(name)) return res.status(400).json({ error: 'Invalid counter: ' + name });
    const value = await redis.incr(key('counter:' + name));
    res.json({ name, value });
  } catch (err) { next(err); }
});

// Reset a counter
router.post('/:name/reset', async (req, res, next) => {
  try {
    const { name } = req.params;
    if (!ALLOWED_COUNTERS.includes(name)) return res.status(400).json({ error: 'Invalid counter: ' + name });
    await redis.set(key('counter:' + name), '0');
    res.json({ name, value: 0 });
  } catch (err) { next(err); }
});

module.exports = router;
