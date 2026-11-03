const router = require('express').Router();
const { redis } = require('../cache');

router.get('/health', async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'healthy', service: 'pulseboard' });
  } catch (err) {
    console.error('Redis health probe failed:', err.message);
    res.status(503).json({ status: 'unhealthy' });
  }
});

module.exports = router;
