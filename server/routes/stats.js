const router = require('express').Router();
const { redis, key } = require('../cache');

router.get('/', async (req, res, next) => {
  try {
    const info = await redis.info('memory');
    const usedMemMatch = info.match(/used_memory_human:(.+)/);
    const peakMemMatch = info.match(/used_memory_peak_human:(.+)/);
    const connectedClients = await redis.info('clients');
    const clientMatch = connectedClients.match(/connected_clients:(\d+)/);

    const leaderboardSize = await redis.zCard(key('leaderboard'));

    if (!usedMemMatch || !peakMemMatch || !clientMatch) throw new Error('Redis INFO returned an unexpected response');

    res.json({
      usedMemory: usedMemMatch[1].trim(),
      peakMemory: peakMemMatch[1].trim(),
      connectedClients: Number(clientMatch[1]),
      leaderboardSize,
    });
  } catch (err) { next(err); }
});

module.exports = router;
