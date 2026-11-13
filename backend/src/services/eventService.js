const db = require('../db');
const { publish } = require('./eventBus');
const notifications = require('./notificationService');

// Canonical event types required by Levels 3–4, plus legacy/diagnostic types
// still emitted by the Phase-1 firmware and the simulator.
const EVENT_TYPES = new Set([
  'BOOT', 'STATUS', 'FIRE', 'FIRE_CLEARED', 'SILENCED', 'PANIC',
  'CARD_TAP', 'ENTRY_GRANTED', 'ENTRY_DENIED', 'SENSOR_ERROR',
  'SETTINGS_APPLIED', 'UNKNOWN_CARD', 'DOOR_CHANGE', 'COMMAND_ACK',
]);

const LEGACY = {
  rfid_scan: 'CARD_TAP',
  flame_alert: 'FIRE',
  flame_clear: 'FIRE_CLEARED',
  boot: 'BOOT',
  door_change: 'DOOR_CHANGE',
  command_ack: 'COMMAND_ACK',
  temp_alert: 'STATUS',
  sensor_error: 'SENSOR_ERROR',
};

function badInput(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function int(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function canonicalType(type, payload) {
  const raw = String(type || '').trim();
  if (!raw) throw badInput('event type is required');
  const mapped = LEGACY[raw.toLowerCase()] || raw.toUpperCase();
  if (!EVENT_TYPES.has(mapped)) throw badInput(`unsupported event type: ${raw}`);
  if (raw.toLowerCase() === 'flame_alert' && payload && payload.active === false) return 'FIRE_CLEARED';
  return mapped;
}

function dhakaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function resolveTs(value) {
  const n = int(value);
  if (n == null) return Math.floor(Date.now() / 1000);
  const now = Date.now() / 1000;
  if (n < 1577836800 || n > now + 86400) return Math.floor(now);
  return n;
}

async function roomState(roomId) {
  const { rows } = await db.query('SELECT * FROM room_state WHERE room_id = $1', [roomId]);
  if (rows.length) return rows[0];
  const created = await db.query(
    'INSERT INTO room_state (room_id) VALUES ($1) ON CONFLICT (room_id) DO UPDATE SET updated_at = room_state.updated_at RETURNING *',
    [roomId]
  );
  return created.rows[0];
}

async function recordAttendance({ deviceId, roomId, uid, user, role, eventId, ts, status = 'present' }) {
  const date = dhakaDate(new Date(ts * 1000));
  const { rows } = await db.query(
    `INSERT INTO attendance (device_id, room_id, uid, role, event_id, user_id, status, attendance_date, event_ts, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id, attendance_date) WHERE user_id IS NOT NULL AND attendance_date IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [deviceId, roomId, uid, role, eventId || null, user ? user.id : null, status, date, new Date(ts * 1000), new Date(ts * 1000)]
  );
  if (!rows.length) return null;
  publish('attendance', rows[0]);
  return rows[0];
}

async function insertServerEvent({ roomId, deviceId, type, detail, payload }) {
  const { rows } = await db.query(
    `INSERT INTO events (device_id, room_id, type, payload, device_ts, detail, server_generated)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,true) RETURNING *`,
    [deviceId || 'server', roomId || null, type, JSON.stringify(payload || {}), Math.floor(Date.now() / 1000), detail || null]
  );
  publish('event', rows[0]);
  return rows[0];
}

async function handleFire(roomId, deviceId, payload, ts) {
  const before = await roomState(roomId);
  await db.query(
    `UPDATE room_state SET status = 'FIRE', fire_latched = true, updated_at = now() WHERE room_id = $1`,
    [roomId]
  );
  if (deviceId) {
    await db.query('UPDATE devices SET fire_latched = true, status = $2 WHERE device_id = $1', [deviceId, 'FIRE']);
  }
  if (!before.fire_latched) {
    await notifications.notifySafety({
      roomId,
      eventType: 'FIRE',
      message: `FIRE detected in ${roomId}. Door unlocked. Evacuate. Device: ${deviceId || 'unknown'}.`,
    });
  }
  return ts;
}

async function handleFireCleared(roomId, deviceId) {
  // Flame is gone but the latch stays until an authorized reset, so the room
  // remains in FIRE state rather than silently returning to SAFE.
  await db.query(
    `UPDATE room_state SET status = CASE
       WHEN fire_latched THEN 'FIRE'
       WHEN panic_active THEN 'PANIC'
       ELSE 'SAFE' END,
       updated_at = now()
     WHERE room_id = $1`,
    [roomId]
  );
  if (deviceId) {
    await db.query(
      'UPDATE devices SET status = CASE WHEN fire_latched THEN \'FIRE\' ELSE \'SAFE\' END WHERE device_id = $1',
      [deviceId]
    );
  }
}

async function handlePanic(roomId, deviceId, before, payload) {
  // Firmware sends {active:true} on trigger and {active:false} when the local
  // 10 s alert ends. Legacy producers without the flag keep toggle semantics.
  const explicit = payload && typeof payload.active === 'boolean' ? payload.active : null;
  const active = explicit != null ? explicit : !before.panic_active;
  const status = before.fire_latched ? 'FIRE' : (active ? 'PANIC' : 'SAFE');
  await db.query(
    'UPDATE room_state SET status = $2, panic_active = $3, updated_at = now() WHERE room_id = $1',
    [roomId, status, active]
  );
  if (deviceId) {
    await db.query('UPDATE devices SET status = $2 WHERE device_id = $1', [deviceId, status]);
  }
  if (active && !before.panic_active) {
    await notifications.notifySafety({
      roomId,
      eventType: 'PANIC',
      message: `PANIC triggered in ${roomId}. Device: ${deviceId || 'unknown'}.`,
    });
  }
}

// Ingest a single event for an authenticated device.
async function ingest(device, raw) {
  const body = raw || {};
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload
    : {};
  const type = canonicalType(body.type, payload);
  const roomId = String(body.room_id || body.roomId || device.room_id || '').trim();
  if (!roomId) throw badInput('room_id is required');
  const seq = int(body.seq);
  const ts = resolveTs(body.ts != null ? body.ts : body.deviceTs);
  const detail = String(
    body.detail != null ? body.detail
      : (payload.detail != null ? payload.detail : (payload.message != null ? payload.message : ''))
  ).slice(0, 500);

  if (seq != null) {
    const dup = await db.query(
      'SELECT id FROM events WHERE device_id = $1 AND seq = $2',
      [device.device_id, seq]
    );
    if (dup.rows.length) {
      const err = new Error('duplicate event sequence');
      err.status = 409;
      throw err;
    }
  }

  let rows;
  try {
    ({ rows } = await db.query(
      `INSERT INTO events (device_id, room_id, type, payload, device_ts, seq, ts, detail)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING *`,
      [device.device_id, roomId, type, JSON.stringify(payload), ts, seq, ts, detail || null]
    ));
  } catch (err) {
    if (err.code === '23505') {
      err.status = 409;
      err.message = 'duplicate event sequence';
    }
    throw err;
  }

  const event = rows[0];
  publish('event', event);

  const before = await roomState(roomId);
  let attendance = null;

  if (type === 'FIRE') await handleFire(roomId, device.device_id, payload, ts);
  else if (type === 'FIRE_CLEARED') await handleFireCleared(roomId, device.device_id);
  else if (type === 'PANIC') await handlePanic(roomId, device.device_id, before, payload);
  else if (type === 'SILENCED') {
    await db.query('UPDATE room_state SET fire_silenced = true, updated_at = now() WHERE room_id = $1', [roomId]);
  } else if (type === 'BOOT') {
    await db.query(
      'UPDATE devices SET last_seen = now(), last_reset_reason = COALESCE($2, last_reset_reason) WHERE device_id = $1',
      [device.device_id, payload.reset_reason || payload.resetReason || null]
    );
    await db.query('UPDATE room_state SET panic_active = false, updated_at = now() WHERE room_id = $1', [roomId]);
  } else if (type === 'DOOR_CHANGE' && payload.state) {
    publish('door', { deviceId: device.device_id, roomId, state: payload.state, at: event.created_at });
  } else if (type === 'CARD_TAP') {
    const uid = String(payload.uid || payload.card_uid || '').trim().toUpperCase();
    const cardRows = uid
      ? (await db.query(
        `SELECT c.uid, c.role, c.active, u.id, u.display_name, u.email, u.class_label
         FROM cards c LEFT JOIN users u ON u.id = c.user_id WHERE c.uid = $1`,
        [uid]
      )).rows
      : [];
    const registry = await db.query('SELECT count(*)::int AS n FROM cards');
    const card = cardRows[0];
    const registryPopulated = (registry.rows[0] && registry.rows[0].n > 0);
    const deviceAccepted = payload.accepted === true;
    const accepted = registryPopulated ? Boolean(card && card.active) : deviceAccepted;
    const role = card ? card.role : (payload.role || 'unknown');

    if (!accepted && uid && registryPopulated && !card) {
      await insertServerEvent({
        roomId,
        deviceId: device.device_id,
        type: 'UNKNOWN_CARD',
        detail: `Unknown card ${uid}`,
        payload: { uid },
      });
    }
    if (accepted && card && card.id) {
      attendance = await recordAttendance({
        deviceId: device.device_id,
        roomId,
        uid,
        user: { id: card.id },
        role,
        eventId: event.id,
        ts,
      });
      if (attendance) {
        await insertServerEvent({
          roomId,
          deviceId: device.device_id,
          type: 'ENTRY_GRANTED',
          detail: `${card.display_name || role} entered`,
          payload: { uid, user_id: card.id },
        });
      }
    } else if (!accepted) {
      await insertServerEvent({
        roomId,
        deviceId: device.device_id,
        type: 'ENTRY_DENIED',
        detail: uid ? `Denied ${uid}` : 'Denied card tap',
        payload: { uid },
      });
    }
    event.accepted = accepted;
    event.role = role;
  } else if (type === 'SENSOR_ERROR') {
    await notifications.notifySafety({
      roomId,
      eventType: 'SENSOR_ERROR',
      message: `Sensor error in ${roomId}: ${detail || JSON.stringify(payload)}`,
    });
  }

  return { event, attendance };
}

async function ingestMany(device, list) {
  const saved = [];
  for (const ev of list) {
    // A replay/validation failure of one event must not drop the rest of a
    // buffered batch; report per-event status instead.
    try {
      const result = await ingest(device, ev);
      saved.push({ ok: true, event: result.event, attendance: result.attendance });
    } catch (err) {
      saved.push({ ok: false, error: err.message, status: err.status || 500, type: ev && ev.type });
    }
  }
  return saved;
}

module.exports = { EVENT_TYPES, dhakaDate, ingest, ingestMany, insertServerEvent, roomState };
