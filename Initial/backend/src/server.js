const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { authRateLimit, writeRateLimit } = require('./middleware/rateLimit');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use('/api', authRateLimit, writeRateLimit);

// Health check for Render + local monitoring. Reports DB reachability.
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    console.error(`[health] database unavailable: ${config.redact(err.message)}`);
    res.status(503).json({ status: 'degraded', db: 'down', error: 'database unavailable' });
  }
});

// Device-facing API (token auth).
app.use('/api/device', require('./routes/device'));

// Dashboard / operator API.
app.use('/api/devices', require('./routes/devices'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/readings', require('./routes/readings'));
app.use('/api/events', require('./routes/events'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/door', require('./routes/door'));
app.use('/api/stream', require('./routes/stream'));

// Extension point for later phases/levels.
app.use('/api/features', require('./features'));

// Static dashboard (public/index.html, app.js, styles.css).
app.use(express.static(path.join(__dirname, '../public')));

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port} (${config.nodeEnv})`);
  });
}

module.exports = app;