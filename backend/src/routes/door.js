const express = require('express');
const db = require('../db');
const commands = require('../services/commandService');
const { anyAuth, requireAuth, requireRole, assertRoomAccess } = require('../middleware/userAuth');
const { asyncHandler } = require('../util');

const router = express.Router();

// Resolve the target device for a command: explicit id, else newest in room.
async function resolveDevice({ deviceId, roomId }) {
  if (deviceId) {
    const { rows } = await db.query(
      'SELECT * FROM devices WHERE device_id = $1 AND revoked_at IS NULL',
      [deviceId]
    );
    return rows[0] || null;
  }
  if (roomId) {
    const { rows } = await db.query(
      `SELECT * FROM devices WHERE room_id = $1 AND revoked_at IS NULL
       ORDER BY last_seen DESC NULLS LAST LIMIT 1`,
      [roomId]
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    'SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY last_seen DESC NULLS LAST LIMIT 1'
  );
  return rows[0] || null;
}

// GET /api/door?roomId=&deviceId= — latest known door state.
router.get('/', anyAuth, asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.roomId) { params.push(req.query.roomId); where.push(`room_id = $${params.length}`); }
  if (req.query.deviceId) { params.push(req.query.deviceId); where.push(`device_id = $${params.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') + ' AND ' : 'WHERE ';

  const reading = await db.query(
    `SELECT device_id, room_id, door_state, created_at FROM sensor_readings
     ${clause} door_state IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
    params
  );
  if (reading.rows.length) {
    const r = reading.rows[0];
    return res.json({ ok: true, state: r.door_state, deviceId: r.device_id, roomId: r.room_id, at: r.created_at, source: 'telemetry' });
  }

  const ev = await db.query(
    `SELECT device_id, room_id, payload->>'state' AS door_state, created_at FROM events
     ${clause} type = 'DOOR_CHANGE' ORDER BY created_at DESC, id DESC LIMIT 1`,
    params
  );
  if (ev.rows.length) {
    const r = ev.rows[0];
    return res.json({ ok: true, state: r.door_state, deviceId: r.device_id, roomId: r.room_id, at: r.created_at, source: 'event' });
  }

  res.json({ ok: true, state: 'UNKNOWN', source: 'none' });
}));

// POST /api/door { action: 'lock'|'unlock', deviceId?, roomId? } -> command.
router.post('/', requireAuth, requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const action = String((req.body && req.body.action) || '').toLowerCase();
  if (!['lock', 'unlock'].includes(action)) {
    return res.status(400).json({ error: "action must be 'lock' or 'unlock'" });
  }
  const device = await resolveDevice({ deviceId: req.body.deviceId, roomId: req.body.roomId });
  if (!device) return res.status(404).json({ error: 'no target device found' });
  if (req.user.role === 'teacher') await assertRoomAccess(req, device.room_id);
  const cmd = await commands.create(device.device_id, action, { roomId: device.room_id }, req.user.id);
  res.json({ ok: true, command: cmd });
}));

module.exports = router;
