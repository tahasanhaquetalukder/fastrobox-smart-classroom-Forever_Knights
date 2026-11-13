const crypto = require('crypto');
const config = require('../config');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Legacy operator token. Mutations fail closed when ADMIN_TOKEN is not set.
// User sessions with the admin role are handled by requireRole in userAuth.
function adminAuth(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({ error: 'admin authentication is not configured' });
  }
  const provided = (req.get('x-admin-token') || '').trim();
  if (provided && safeEqual(provided, config.adminToken)) return next();
  return res.status(401).json({ error: 'valid admin token required' });
}

// Legacy operator read token (or admin token).
function readAuth(req, res, next) {
  if (!config.readToken && !config.adminToken) {
    return res.status(503).json({ error: 'read authentication is not configured' });
  }
  const readToken = (req.get('x-read-token') || '').trim();
  const adminToken = (req.get('x-admin-token') || '').trim();
  if (config.readToken && readToken && safeEqual(readToken, config.readToken)) {
    req.authRole = 'read';
    return next();
  }
  if (config.adminToken && adminToken && safeEqual(adminToken, config.adminToken)) {
    req.authRole = 'admin';
    return next();
  }
  return res.status(401).json({ error: 'valid read or admin token required' });
}

module.exports = { adminAuth, readAuth, safeEqual };
