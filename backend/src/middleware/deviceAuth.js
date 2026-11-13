const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { hashToken } = require('../services/deviceService');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function extractToken(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return (req.get('x-device-token') || '').trim();
}

// Authenticate a device by active per-device token (hashed in DB), or the
// shared bootstrap token when explicitly enabled. Attaches req.device.
async function deviceAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'missing device token' });

    const digest = hashToken(token);
    const { rows } = await db.query(
      `SELECT device_id, name, room_id, last_seen, created_at,
              token_issued_at, token_rotated_at, revoked_at, token_hash
       FROM devices WHERE token_hash = $1`,
      [digest]
    );
    if (rows.length && !rows[0].revoked_at && safeEqual(digest, rows[0].token_hash)) {
      const { token_hash, ...device } = rows[0];
      req.device = device;
      return next();
    }

    if (config.deviceBootstrapEnabled && config.deviceToken && safeEqual(token, config.deviceToken)) {
      const body = req.body || {};
      const deviceId = String(req.get('x-device-id') || body.deviceId || '').trim();
      const roomId = String(body.roomId || body.room_id || config.defaultRoomId || '').trim();
      if (!deviceId || !roomId) {
        return res.status(400).json({ error: 'device id and room id are required for bootstrap' });
      }
      const up = await db.query(
        `INSERT INTO devices (device_id, name, room_id, last_seen)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (device_id) DO UPDATE SET last_seen = now()
         RETURNING device_id, name, room_id, last_seen, created_at,
                   token_issued_at, token_rotated_at, revoked_at`,
        [deviceId, deviceId, roomId]
      );
      if (up.rows[0].revoked_at) return res.status(401).json({ error: 'invalid device token' });
      req.device = up.rows[0];
      return next();
    }

    return res.status(401).json({ error: 'invalid device token' });
  } catch (err) {
    next(err);
  }
}

module.exports = { deviceAuth, sha256: hashToken };
