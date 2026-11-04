const router = require('express').Router();
const { redis, key } = require('../cache');

// Get top N players
router.get('/', async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ error: 'limit must be 1-100' });
    const members = await redis.zRangeWithScores(key('leaderboard'), 0, limit - 1, { REV: true });
    const leaderboard = members.map((member, i) => ({ rank: i + 1, name: member.value, score: member.score }));
    res.json(leaderboard);
  } catch (err) { next(err); }
});

// Add or update a player's score
router.post('/', async (req, res, next) => {
  try {
    const { name, score } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 50 || !Number.isSafeInteger(score)) {
      return res.status(400).json({ error: 'name must be 1-50 characters and score a safe integer' });
    }
    await redis.zAdd(key('leaderboard'), { score, value: name });
    const rank = await redis.zRevRank(key('leaderboard'), name);
    res.json({ name, score, rank: rank === null ? null : rank + 1 });
  } catch (err) { next(err); }
});

// Increment a player's score
router.post('/:name/increment', async (req, res, next) => {
  try {
    const { amount = 1 } = req.body;
    if (!Number.isSafeInteger(amount) || req.params.name.length > 50) return res.status(400).json({ error: 'Invalid name or amount' });
    const newScore = await redis.zIncrBy(key('leaderboard'), amount, req.params.name);
    const rank = await redis.zRevRank(key('leaderboard'), req.params.name);
    res.json({ name: req.params.name, score: newScore, rank: rank === null ? null : rank + 1 });
  } catch (err) { next(err); }
});

// Remove a player
router.delete('/:name', async (req, res, next) => {
  try {
    await redis.zRem(key('leaderboard'), req.params.name);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
