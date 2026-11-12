const express = require('express');
const config = require('./config');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check for Render + local monitoring. Reports DB reachability.
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
  }
});

// REST API routes, SSE stream and the static dashboard are mounted in Task 3.

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port} (${config.nodeEnv})`);
  });
}

module.exports = app;