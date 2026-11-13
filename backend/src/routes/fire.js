const express = require('express');
const db = require('../db');
const commands = require('../services/commandService');
const events = require('../services/eventService');
const { publish } = require('../services/eventBus');
const { requireAuth, requireRole, assertRoomAccess } = require('../middleware/userAuth');
const { asyncHandler } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'teacher'));

async function targetDevice(roomId) {
  const { rows } = await db.query(
    `SELECT * FROM devices WHERE room_id = $1 AND revoked_at IS NULL
     ORDER BY last_seen DESC NULLS LAST LIMIT 1`,
    [roomId]
  );
  return rows[0] || null;
}

async function latestFlame(roomId) {
  const { rows } = await db.query(
    'SELECT flame FROM sensor_readings WHERE room_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [roomId]
  );
  return rows[0] ? rows[0].flame : null;
}

async function ensureRoom(req) {
  const roomId = String((req.body && req.body.roomId) || req.query.roomId || '').trim();
  if (!roomId) {
    const err = new Error('roomId is required');
    err.status = 400;
    throw err;
  }
  await assertRoomAccess(req, roomId);
  return roomId;
}

// POST /api/fire/reset { roomId, note } — authorized fire reset.
router.post('/reset', asyncHandler(async (req, res) => {
  const roomId = await ensureRoom(req);
  const state = await events.roomState(roomId);
  if (!state.fire_latched && state.status !== 'FIRE') {
    return res.status(409).json({ error: 'fire is not latched for this room' });
  }
  if (await latestFlame(roomId)) {
    return res.status(409).json({ error: 'flame is still detected; reset refused' });
  }

  await db.query(
    `UPDATE room_state SET fire_latched = false, fire_silenced = false,
       status = CASE WHEN panic_active THEN 'PANIC' ELSE 'SAFE' END, updated_at = now()
     WHERE room_id = $1`,
    [roomId]
  );
  await db.query(
    `UPDATE devices SET fire_latched = false,
       status = CASE WHEN status = 'FIRE' THEN 'SAFE' ELSE status END
     WHERE room_id = $1`,
    [roomId]
  );

  const event = await events.insertServerEvent({
    roomId,
    deviceId: null,
    type: 'FIRE_CLEARED',
    detail: `Fire reset authorized by ${req.user.email || req.user.display_name}`,
    payload: { note: req.body && req.body.note ? String(req.body.note).slice(0, 200) : null, resetBy: req.user.email || 'operator' },
  });

  const device = await targetDevice(roomId);
  let command = null;
  if (device) command = await commands.create(device.device_id, 'fire_reset', { roomId }, req.user.id);

  publish('state', { roomId, fire_latched: false, fire_silenced: false });
  res.json({ ok: true, event, command, roomId });
}));

// POST /api/fire/silence { roomId } — silence buzzer after flame is gone.
router.post('/silence', asyncHandler(async (req, res) => {
  const roomId = await ensureRoom(req);
  const state = await events.roomState(roomId);
  if (!state.fire_latched && state.status !== 'FIRE') {
    return res.status(409).json({ error: 'there is no active fire alarm to silence' });
  }
  if (await latestFlame(roomId)) {
    return res.status(409).json({ error: 'flame is still detected; silencing is not allowed' });
  }

  await db.query(
    'UPDATE room_state SET fire_silenced = true, updated_at = now() WHERE room_id = $1',
    [roomId]
  );
  const event = await events.insertServerEvent({
    roomId,
    deviceId: null,
    type: 'SILENCED',
    detail: `Buzzer silenced by ${req.user.email || req.user.display_name}`,
    payload: { by: req.user.email || 'operator' },
  });
  const device = await targetDevice(roomId);
  let command = null;
  if (device) command = await commands.create(device.device_id, 'silence_fire', { roomId }, req.user.id);

  res.json({ ok: true, event, command, roomId });
}));

// GET /api/fire/state?roomId=
router.get('/state', asyncHandler(async (req, res) => {
  const roomId = await ensureRoom(req);
  res.json({ ok: true, state: await events.roomState(roomId) });
}));

module.exports = router;
