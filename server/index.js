const express = require('express');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');
const { redis, seedDemoData, diagnostics } = require('./cache');

const app = express();
app.use(express.json());

// API routes
app.use('/', require('./routes/health'));
app.use('/api', require('./routes/health'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/counters', require('./routes/counters'));
app.use('/api/cache-demo', require('./routes/cacheDemo'));
app.use('/api/stats', require('./routes/stats'));

// Serve static build output
const distPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use(errorHandler);

async function start() {
  await redis.connect();
  await diagnostics?.attach(redis);
  await redis.ping();
  await seedDemoData();
  const port = Number(process.env.PORT || 8080);
  const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log('PulseBoard running on port ' + port + ' with Azure Managed Redis');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => {
        // HTTP requests have drained; destroy also disposes streaming token subscriptions.
        redis.destroy();
        diagnostics?.stop();
      });
    });
  }
}

start().catch((err) => {
  console.error('PulseBoard startup failed:', err.message);
  redis.destroy();
  diagnostics?.stop();
  process.exitCode = 1;
});
