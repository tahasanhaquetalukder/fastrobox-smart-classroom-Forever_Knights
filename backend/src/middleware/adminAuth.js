const crypto = require('crypto');
const config = require('../config');

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Optional guard for mutating dashboard routes. Disabled when ADMIN_TOKEN is
// unset (live demo). When set, callers must send a matching X-Admin-Token.
function adminAuth(req, res, next) {
  if (!config.adminToken) return next();
  const provided = (req.get('x-admin-token') || '').trim();
  if (provided && safeEqual(provided, config.adminToken)) return next();
  return res.status(403).json({ error: 'admin token required' });
}

module.exports = { adminAuth };