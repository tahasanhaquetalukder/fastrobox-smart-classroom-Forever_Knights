const crypto = require('crypto');
const config = require('../config');

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function adminAuth(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({ error: 'admin authentication is not configured' });
  }
  const provided = (req.get('x-admin-token') || '').trim();
  if (provided && safeEqual(provided, config.adminToken)) return next();
  return res.status(401).json({ error: 'valid admin token required' });
}

module.exports = { adminAuth };
