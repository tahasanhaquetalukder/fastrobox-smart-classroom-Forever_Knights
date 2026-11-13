const express = require('express');
const db = require('../db');
const { deviceAuth } = require('../middleware/deviceAuth');
const commands = require('../services/commandService');
const { publish } = require('../services/eventBus');
const { asyncHandler } = require('../util');

const router = express.Router();
router.use(deviceAuth);

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function bool(v) {
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return null;
}

function touchDevice(deviceId) {
  return db.query('UPDATE devices SET last_seen = now() WHERE device_id = $1', [deviceId]);
}

// POST /api/device/telemetry
router.post('/telemetry', asyncHandler(async (req, res) => {
  const deviceId = req.device.device_id;
  const b = req.body || {};
  const roomId = b.roomId || req.device.room_id;
  const { rows } = await db.query(
    `INSERT INTO sensor_readings
       (device_id, room_id, temperature, humidity, flame, door_state, rssi, uptime_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [deviceId, roomId, num(b.temperature), num(b.humidity), bool(b.flame),
     b.doorState || null, int(b.rssi), int(b.uptimeMs)]
  );
  await touchDevice(deviceId);
  publish('reading', rows[0]);
  res.json({ ok: true, reading: rows[0] });
}));

// POST /api/device/events — accepts a single event or { events: [...] } for
// offline batch flush. Derives attendance from accepted RFID scans.
router.post('/events', asyncHandler(async (req, res) => {
  const deviceId = req.device.device_id;
  const body = req.body || {};
  const list = Array.isArray(body.events) ? body.events : [body];
  const saved = [];

  for (const ev of list) {
    if (!ev || !ev.type) continue;
    const roomId = ev.roomId || req.device.room_id;
    const { rows } = await db.query(
      `INSERT INTO events (device_id, room_id, type, payload, device_ts)
       VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
      [deviceId, roomId, ev.type, JSON.stringify(ev.payload || {}), int(ev.deviceTs)]
    );
    const event = rows[0];
    saved.push(event);
    publish('event', event);

    const p = ev.payload || {};
    if (ev.type === 'rfid_scan' && p.accepted && p.uid) {
      const att = await db.query(
        `INSERT INTO attendance (device_id, room_id, uid, role, event_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [deviceId, roomId, p.uid, p.role || 'student', event.id]
      );
      publish('attendance', att.rows[0]);
    }
    if (ev.type === 'door_change' && p.state) {
      publish('door', { deviceId, roomId, state: p.state, at: event.created_at });
    }
  }

  await touchDevice(deviceId);
  res.json({ ok: true, saved: saved.length, events: saved });
}));

// GET /api/device/commands — polling; returns pending and marks delivered.
router.get('/commands', asyncHandler(async (req, res) => {
  const deviceId = req.device.device_id;
  const list = await commands.pendingFor(deviceId);
  await touchDevice(deviceId);
  res.json({ ok: true, commands: list });
}));

// POST /api/device/commands/:id/ack
router.post('/commands/:id/ack', asyncHandler(async (req, res) => {
  const deviceId = req.device.device_id;
  const status = (req.body && req.body.status) || 'acked';
  const cmd = await commands.ack(deviceId, parseInt(req.params.id, 10), status);
  if (!cmd) return res.status(404).json({ error: 'command not found' });
  res.json({ ok: true, command: cmd });
}));

module.exports = router;