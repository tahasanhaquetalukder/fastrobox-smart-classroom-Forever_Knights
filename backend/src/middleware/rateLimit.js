const config = require('../config');

const buckets = new Map();

function keyFor(req, scope) {
  return `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

function stateFor(key, now) {
  const state = buckets.get(key);
  if (!state || state.resetAt <= now) return { count: 0, resetAt: now + config.rateLimitWindowMs };
  return state;
}

function sweep(now) {
  if (buckets.size < 1000) return;
  for (const [key, state] of buckets) {
    if (state.resetAt <= now) buckets.delete(key);
  }
}

function reject(res, state, now) {
  const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'rate limit exceeded' });
}

// Counts failed authentication responses (401/403) per IP.
function authRateLimit(req, res, next) {
  const now = Date.now();
  sweep(now);
  const key = keyFor(req, 'auth');
  const state = stateFor(key, now);
  if (state.count >= config.authFailureLimit) return reject(res, state, now);
  res.on('finish', () => {
    if (res.statusCode !== 401 && res.statusCode !== 403) return;
    const failed = stateFor(key, Date.now());
    failed.count++;
    buckets.set(key, failed);
  });
  next();
}

// Limits non-read API writes per IP.
function writeRateLimit(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const now = Date.now();
  sweep(now);
  const key = keyFor(req, 'write');
  const state = stateFor(key, now);
  if (state.count >= config.writeLimit) return reject(res, state, now);
  state.count++;
  buckets.set(key, state);
  next();
}

module.exports = { authRateLimit, writeRateLimit };
