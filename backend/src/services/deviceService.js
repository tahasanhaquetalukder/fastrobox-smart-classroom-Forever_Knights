const crypto = require('crypto');
const db = require('../db');

const DEVICE_COLUMNS = `device_id, name, room_id, last_seen, created_at,
  status, firmware, uptime_s, rssi, heap_kb, chip_temp_c, last_reset_reason,
  token_issued_at, token_rotated_at, revoked_at`;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function createDevice({ deviceId, roomId, name }) {
  const token = issueToken();
  try {
    const { rows } = await db.query(
      `INSERT INTO devices
         (device_id, name, room_id, token_hash, token_issued_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING ${DEVICE_COLUMNS}`,
      [deviceId, name || deviceId, roomId, hashToken(token)]
    );
    return { device: rows[0], token };
  } catch (err) {
    if (err.code === '23505') {
      err.status = 409;
      err.message = 'device already exists';
    }
    throw err;
  }
}

async function rotateDeviceToken(deviceId) {
  const current = await db.query('SELECT revoked_at FROM devices WHERE device_id = $1', [deviceId]);
  if (!current.rows.length) return null;
  if (current.rows[0].revoked_at) {
    const err = new Error('revoked device cannot rotate a token');
    err.status = 409;
    throw err;
  }

  const token = issueToken();
  const { rows } = await db.query(
    `UPDATE devices
     SET token_hash = $2, token_rotated_at = now()
     WHERE device_id = $1 AND revoked_at IS NULL
     RETURNING ${DEVICE_COLUMNS}`,
    [deviceId, hashToken(token)]
  );
  return rows.length ? { device: rows[0], token } : null;
}

async function revokeDevice(deviceId) {
  const { rows } = await db.query(
    `UPDATE devices
     SET token_hash = NULL, revoked_at = COALESCE(revoked_at, now())
     WHERE device_id = $1
     RETURNING ${DEVICE_COLUMNS}`,
    [deviceId]
  );
  return rows[0] || null;
}

async function listDevices() {
  const { rows } = await db.query(
    `SELECT ${DEVICE_COLUMNS},
            (last_seen > now() - interval '30 seconds') AS online
     FROM devices ORDER BY room_id, device_id`
  );
  return rows;
}

module.exports = { createDevice, hashToken, listDevices, revokeDevice, rotateDeviceToken };
