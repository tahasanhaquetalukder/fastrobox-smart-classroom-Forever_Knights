const db = require('../db');
const { publish } = require('./eventBus');
const notifications = require('./notificationService');

const STATUSES = new Set([
  'SAFE', 'WARNING', 'DANGER', 'FIRE', 'PANIC',
  'SENSOR_ERROR', 'CAMERA_FAULT', 'WEATHER_DANGER', 'OFFLINE',
]);
const TRENDS = new Set(['RISING', 'STABLE', 'FALLING']);

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bool(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return null;
}

function text(v, max = 64) {
  return typeof v === 'string' ? v.trim().slice(0, max) : null;
}

// Rothfusz heat index in Celsius. Returns null when inputs are unusable.
function heatIndexC(tempC, rh) {
  if (tempC == null || rh == null) return null;
  const t = (tempC * 9) / 5 + 32;
  const f = 0.5 * (t + 61 + ((t - 68) * 1.2) + rh * 0.094);
  let hi;
  if ((f + t) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * t + 10.14333127 * rh
      - 0.22475541 * t * rh - 0.00683783 * t * t - 0.05481717 * rh * rh
      + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh
      - 0.00000199 * t * t * rh * rh;
    if (rh < 13 && t >= 80 && t <= 112) {
      hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (rh > 85 && t >= 80 && t <= 87) {
      hi += ((rh - 85) / 10) * ((87 - t) / 5);
    }
  } else {
    hi = f;
  }
  return Math.round(((hi - 32) * 5) / 9 * 10) / 10;
}

function sensorsValid(tempC, rh) {
  const tempOk = tempC == null || (tempC >= 0 && tempC <= 50);
  const rhOk = rh == null || (rh >= 20 && rh <= 90);
  return tempOk && rhOk;
}

// Unix seconds, UTC. Rejects implausible values (uptime sent as ts, etc.).
function resolveTs(value) {
  const n = int(value);
  if (n == null) return Math.floor(Date.now() / 1000);
  const now = Date.now() / 1000;
  if (n < 1577836800 || n > now + 86400) return Math.floor(now);
  return n;
}

function normalize(device, body = {}) {
  const roomId = text(body.room_id || body.roomId || device.room_id, 64);
  if (!roomId) {
    const err = new Error('room_id is required');
    err.status = 400;
    throw err;
  }
  const tempC = num(body.temp_c != null ? body.temp_c : body.temperature);
  const rh = num(body.rh != null ? body.rh : body.humidity);
  if (tempC == null && rh == null) {
    const err = new Error('temp_c or rh is required');
    err.status = 400;
    throw err;
  }
  if ((tempC != null && (tempC < -40 || tempC > 85)) || (rh != null && (rh < 0 || rh > 100))) {
    const err = new Error('sensor value out of physical range');
    err.status = 400;
    throw err;
  }

  const seq = int(body.seq);
  if (seq != null && seq < 0) {
    const err = new Error('seq must be a non-negative integer');
    err.status = 400;
    throw err;
  }

  let status = text(body.status, 32);
  status = status ? status.toUpperCase() : null;
  if (status && !STATUSES.has(status)) status = null;

  let heatTrend = text(body.heat_trend || body.heatTrend, 16);
  heatTrend = heatTrend ? heatTrend.toUpperCase() : null;
  if (heatTrend && !TRENDS.has(heatTrend)) heatTrend = null;

  const valid = sensorsValid(tempC, rh);
  let quality = text(body.quality, 8);
  quality = quality === 'bad' || quality === 'good' ? quality : (valid ? 'good' : 'bad');
  if (!valid) quality = 'bad';

  return {
    roomId,
    seq,
    ts: resolveTs(body.ts),
    uptimeS: int(body.uptime_s != null ? body.uptime_s : body.uptimeS),
    tempC,
    rh,
    heatIndexC: num(body.heat_index_c != null ? body.heat_index_c : body.heatIndexC) ?? heatIndexC(tempC, rh),
    heatTrend,
    flame: bool(body.flame),
    door: text(body.door || body.doorState || body.door_state, 16),
    status,
    quality,
    rssi: int(body.rssi),
    heapKb: num(body.heap_kb != null ? body.heap_kb : body.heapKb),
    chipTempC: num(body.chip_temp_c != null ? body.chip_temp_c : body.chipTempC),
    fw: text(body.fw || body.firmware, 32),
    resetReason: text(body.reset_reason || body.resetReason, 64),
  };
}

async function ingest(device, body) {
  const t = normalize(device, body);

  if (t.seq != null) {
    const dup = await db.query(
      'SELECT id FROM sensor_readings WHERE device_id = $1 AND seq = $2',
      [device.device_id, t.seq]
    );
    if (dup.rows.length) {
      const err = new Error('duplicate telemetry sequence');
      err.status = 409;
      throw err;
    }
  }

  const previous = await db.query('SELECT status FROM devices WHERE device_id = $1', [device.device_id]);
  const previousStatus = previous.rows[0] ? previous.rows[0].status : null;
  const effectiveStatus = t.quality === 'bad' && t.status == null
    ? (previousStatus || 'SAFE')
    : (t.status || previousStatus || 'SAFE');

  const createdAt = new Date(t.ts * 1000);
  let rows;
  try {
    ({ rows } = await db.query(
      `INSERT INTO sensor_readings
         (device_id, room_id, temperature, humidity, temp_c, rh, flame, door_state,
          rssi, uptime_ms, uptime_s, seq, ts, heat_index_c, heat_trend, status,
          quality, heap_kb, chip_temp_c, fw, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [device.device_id, t.roomId, t.tempC, t.rh, t.tempC, t.rh, t.flame, t.door,
        t.rssi, t.uptimeS != null ? t.uptimeS * 1000 : null, t.uptimeS, t.seq, t.ts,
        t.heatIndexC, t.heatTrend, effectiveStatus, t.quality, t.heapKb, t.chipTempC, t.fw, createdAt]
    ));
  } catch (err) {
    if (err.code === '23505') {
      err.status = 409;
      err.message = 'duplicate telemetry sequence';
    }
    throw err;
  }

  const isFire = effectiveStatus === 'FIRE';
  const isPanic = effectiveStatus === 'PANIC';

  await db.query(
    `UPDATE devices
     SET last_seen = now(), room_id = $2, status = $3,
         uptime_s = COALESCE($4, uptime_s), rssi = COALESCE($5, rssi),
         heap_kb = COALESCE($6, heap_kb), chip_temp_c = COALESCE($7, chip_temp_c),
         firmware = COALESCE($8, firmware),
         last_reset_reason = COALESCE($9, last_reset_reason),
         fire_latched = CASE WHEN $10 THEN true ELSE fire_latched END
     WHERE device_id = $1`,
    [device.device_id, t.roomId, effectiveStatus, t.uptimeS, t.rssi, t.heapKb, t.chipTempC, t.fw, t.resetReason, isFire]
  );

  await db.query(
    `INSERT INTO room_state (room_id, status, fire_latched, panic_active, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (room_id) DO UPDATE
       SET status = EXCLUDED.status,
           fire_latched = CASE WHEN $3 THEN true ELSE room_state.fire_latched END,
           panic_active = CASE WHEN $4 THEN true
                               WHEN $2 IN ('SAFE','WARNING','DANGER') THEN false
                               ELSE room_state.panic_active END,
           updated_at = now()`,
    [t.roomId, effectiveStatus, isFire, isPanic]
  );

  const reading = rows[0];
  publish('reading', reading);

  if (effectiveStatus === 'FIRE' && previousStatus !== 'FIRE') {
    await notifications.notifySafety({
      roomId: t.roomId,
      eventType: 'FIRE',
      message: `FIRE reported in ${t.roomId} by device ${device.device_id}. Door must be unlocked. Evacuate.`,
    });
  }

  if (effectiveStatus === 'DANGER' && previousStatus !== 'DANGER') {
    await notifications.notifySafety({
      roomId: t.roomId,
      eventType: 'HEAT_DANGER',
      message: `Heat danger in ${t.roomId}: ${t.tempC ?? '?'}°C, ${t.rh ?? '?'}% RH (heat index ${t.heatIndexC ?? '?'}°C).`,
    });
  }

  return reading;
}

module.exports = { heatIndexC, ingest, normalize, sensorsValid };
