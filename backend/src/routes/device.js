const express = require('express');
const db = require('../db');
const { deviceAuth } = require('../middleware/deviceAuth');
const commands = require('../services/commandService');
const telemetry = require('../services/telemetryService');
const events = require('../services/eventService');
const { publish } = require('../services/eventBus');
const { asyncHandler } = require('../util');

const router = express.Router();
router.use(deviceAuth);

function touchDevice(deviceId) {
  return db.query('UPDATE devices SET last_seen = now() WHERE device_id = $1', [deviceId]);
}

// POST /api/device/telemetry
router.post('/telemetry', asyncHandler(async (req, res) => {
  try {
    const reading = await telemetry.ingest(req.device, req.body || {});
    res.json({ ok: true, reading });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ ok: false, error: 'replay rejected: duplicate seq' });
    throw err;
  }
}));

// POST /api/device/events — single event or { events: [...] } for offline flush.
router.post('/events', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.events) ? body.events : [body];
  const results = await events.ingestMany(req.device, list);
  await touchDevice(req.device.device_id);

  const saved = results.filter((r) => r.ok).map((r) => r.event);
  const rejected = results.filter((r) => !r.ok);
  if (rejected.length) {
    console.warn(`[device] ${req.device.device_id} event rejections: ${rejected.map((r) => `${r.type}:${r.error}`).join('; ')}`);
  }
  res.json({ ok: true, saved: saved.length, rejected: rejected.length, events: saved, results });
}));

// POST /api/device/state — lightweight status/health heartbeat from firmware.
router.post('/state', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const roomId = b.room_id || b.roomId || req.device.room_id;
  await db.query(
    `UPDATE devices SET last_seen = now(), room_id = COALESCE($2, room_id),
       status = COALESCE($3, status), uptime_s = COALESCE($4, uptime_s),
       rssi = COALESCE($5, rssi), heap_kb = COALESCE($6, heap_kb),
       chip_temp_c = COALESCE($7, chip_temp_c), firmware = COALESCE($8, firmware),
       last_reset_reason = COALESCE($9, last_reset_reason)
     WHERE device_id = $1`,
    [req.device.device_id, roomId || null, b.status || null,
      Number.isFinite(Number(b.uptime_s)) ? Number(b.uptime_s) : null,
      Number.isFinite(Number(b.rssi)) ? Number(b.rssi) : null,
      Number.isFinite(Number(b.heap_kb)) ? Number(b.heap_kb) : null,
      Number.isFinite(Number(b.chip_temp_c)) ? Number(b.chip_temp_c) : null,
      b.fw || null, b.reset_reason || null]
  );
  publish('device', { device_id: req.device.device_id, room_id: roomId, ...b });
  res.json({ ok: true });
}));

// GET /api/device/commands — polling; returns pending and marks delivered.
router.get('/commands', asyncHandler(async (req, res) => {
  const list = await commands.pendingFor(req.device.device_id);
  await touchDevice(req.device.device_id);
  res.json({ ok: true, commands: list });
}));

// POST /api/device/commands/:id/ack
router.post('/commands/:id/ack', asyncHandler(async (req, res) => {
  const status = (req.body && req.body.status) || 'acked';
  const cmd = await commands.ack(req.device.device_id, parseInt(req.params.id, 10), status);
  if (!cmd) return res.status(404).json({ error: 'command not found' });
  res.json({ ok: true, command: cmd });
}));

module.exports = router;
