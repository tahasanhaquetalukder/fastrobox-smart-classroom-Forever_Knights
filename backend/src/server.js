const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { writeRateLimit } = require('./middleware/rateLimit');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Baseline security headers for the public HTTPS deployment.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  });
  next();
});

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

app.use('/api', writeRateLimit);

// Authentication and role-scoped dashboard.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/fire', require('./routes/fire'));

// Device-facing API (per-device token auth).
app.use('/api/device', require('./routes/device'));

// Operator/legacy API.
app.use('/api/devices', require('./routes/devices'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/readings', require('./routes/readings'));
app.use('/api/events', require('./routes/events'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/door', require('./routes/door'));
app.use('/api/stream', require('./routes/stream'));

// Extension point for later phases/levels (Levels 5-12 are out of scope).
app.use('/api/features', require('./features'));

// Static dashboard (public/index.html, app.js, styles.css).
app.use(express.static(path.join(__dirname, '../public'), { index: 'index.html', maxAge: config.isProduction ? '1h' : 0 }));

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port} (${config.nodeEnv})`);
  });
}

module.exports = app;
