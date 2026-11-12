const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function extractToken(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return (req.get('x-device-token') || '').trim();
}

// Authenticate a device by per-device token (hashed in DB) or the optional env
// bootstrap token. Attaches req.device. Tokens are never hard-coded.
async function deviceAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'missing device token' });

    const { rows } = await db.query('SELECT * FROM devices WHERE token_hash = $1', [sha256(token)]);
    if (rows.length) {
      req.device = rows[0];
      return next();
    }

    if (config.deviceToken && safeEqual(token, config.deviceToken)) {
      const deviceId = String(req.get('x-device-id') || (req.body && req.body.deviceId) || 'default');
      const roomId = (req.body && req.body.roomId) || config.defaultRoomId;
      const up = await db.query(
        `INSERT INTO devices (device_id, name, room_id, last_seen)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (device_id) DO UPDATE SET last_seen = now()
         RETURNING *`,
        [deviceId, deviceId, roomId]
      );
      req.device = up.rows[0];
      return next();
    }

    return res.status(401).json({ error: 'invalid device token' });
  } catch (err) {
    next(err);
  }
}

module.exports = { deviceAuth, sha256 };