const { createConnection } = require('./connection');
const { keyPrefix } = require('./config');
const { redis, provider, config } = createConnection();
const prefix = keyPrefix(config.namespace);
const key = (suffix) => prefix + suffix;

const DEMO_PLAYERS = [
  { name: 'Aria', score: 9450 },
  { name: 'Marcus', score: 8720 },
  { name: 'Zoe', score: 8100 },
  { name: 'Kai', score: 7650 },
  { name: 'Luna', score: 7200 },
  { name: 'Felix', score: 6800 },
  { name: 'Nova', score: 6350 },
  { name: 'Atlas', score: 5900 },
  { name: 'Iris', score: 5400 },
  { name: 'Orion', score: 4950 },
];

async function seedDemoData() {
  const transaction = redis.multi();
  if (!await redis.exists(key('leaderboard'))) {
    transaction.zAdd(key('leaderboard'), DEMO_PLAYERS.map(p => ({ score: p.score, value: p.name })), { NX: true });
  }
  for (const [name, value] of Object.entries({ page_views: 1247, api_calls: 8432, cache_hits: 6218, errors: 23 })) {
    transaction.set(key('counter:' + name), String(value), { NX: true });
  }
  await transaction.exec();
}

module.exports = { redis, provider, seedDemoData, key, config };
