const db = require('../db');
const notifications = require('../services/notificationService');
const settings = require('../services/settingsService');
const { dhakaDate } = require('../services/eventService');
const { accessibleStudents } = require('../middleware/userAuth');

const ONLINE_WINDOW_MS = 30000;

function online(lastSeen) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() <= ONLINE_WINDOW_MS;
}

async function deviceForRoom(roomId) {
  const { rows } = await db.query(
    `SELECT device_id, name, room_id, last_seen, status, fire_latched, firmware,
            uptime_s, rssi, heap_kb, chip_temp_c, last_reset_reason
     FROM devices WHERE room_id = $1
     ORDER BY last_seen DESC NULLS LAST LIMIT 1`,
    [roomId]
  );
  return rows[0] || null;
}

async function latestReading(roomId) {
  const { rows } = await db.query(
    `SELECT * FROM sensor_readings WHERE room_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [roomId]
  );
  return rows[0] || null;
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

async function doorState(roomId, latest) {
  if (latest && latest.door_state) return { state: latest.door_state, at: latest.created_at, source: 'telemetry' };
  const { rows } = await db.query(
    `SELECT payload->>'state' AS state, created_at FROM events
     WHERE room_id = $1 AND type = 'DOOR_CHANGE' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [roomId]
  );
  if (rows.length) return { state: rows[0].state, at: rows[0].created_at, source: 'event' };
  return { state: 'UNKNOWN', at: null, source: 'none' };
}

async function roomSnapshot(roomId) {
  const today = dhakaDate();
  const [device, latest, state, door, taps, events, attendanceToday, readings] = await Promise.all([
    deviceForRoom(roomId),
    latestReading(roomId),
    roomState(roomId),
    (async () => doorState(roomId, await latestReading(roomId)))(),
    db.query(
      `SELECT id, type, payload, detail, created_at FROM events
       WHERE room_id = $1 AND type = 'CARD_TAP' ORDER BY created_at DESC LIMIT 10`,
      [roomId]
    ),
    db.query(
      `SELECT e.id, e.type, e.detail, e.payload, e.created_at,
              u.display_name
       FROM events e
       LEFT JOIN users u ON u.id = CASE
         WHEN e.payload->>'user_id' ~ '^[0-9]+$' THEN (e.payload->>'user_id')::int
         ELSE NULL END
       WHERE e.room_id = $1 ORDER BY e.created_at DESC LIMIT 25`,
      [roomId]
    ),
    db.query(
      `SELECT a.id, a.uid, a.role, a.status, a.created_at, a.attendance_date,
              u.id AS user_id, u.display_name
       FROM attendance a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.room_id = $1 AND a.attendance_date = $2
       ORDER BY a.created_at DESC`,
      [roomId, today]
    ),
    db.query(
      `SELECT temp_c, rh, heat_index_c, heat_trend, status, quality, created_at
       FROM sensor_readings WHERE room_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [roomId]
    ),
  ]);

  return {
    roomId,
    device: device ? { ...device, fw: device.firmware, online: online(device.last_seen) } : null,
    latest,
    roomState: {
      status: state.status,
      fire_latched: state.fire_latched,
      fire_silenced: state.fire_silenced,
      panic_active: state.panic_active,
      updated_at: state.updated_at,
    },
    door,
    recentTaps: taps.rows,
    recentEvents: events.rows,
    attendanceToday: attendanceToday.rows,
    history: readings.rows.reverse(),
    today,
  };
}

async function overview(user, rooms, selectedRoomId) {
  const provider = notifications.providerInfo();
  const settingsAll = await settings.getAll();
  const publicSettings = {
    temp_threshold_c: settingsAll.temp_threshold_c,
    humidity_threshold_pct: settingsAll.humidity_threshold_pct,
    danger_temp_c: settingsAll.danger_temp_c,
    danger_exit_temp_c: settingsAll.danger_exit_temp_c,
    warn_exit_temp_c: settingsAll.warn_exit_temp_c,
    warn_exit_humidity_pct: settingsAll.warn_exit_humidity_pct,
  };

  const selected = selectedRoomId || (rooms[0] && rooms[0].roomId) || null;
  const snapshot = selected ? await roomSnapshot(selected) : null;

  let deviceCounts = null;
  if (user.role === 'admin') {
    const { rows } = await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE last_seen > now() - interval '30 seconds')::int AS online
       FROM devices`
    );
    deviceCounts = rows[0];
  }

  return {
    ok: true,
    serverTime: new Date().toISOString(),
    me: user,
    scope: { rooms, selectedRoomId: selected },
    snapshot,
    deviceCounts,
    settings: publicSettings,
    notifications: provider,
  };
}

async function studentView(user) {
  const today = dhakaDate();
  const { rows } = await db.query(
    `SELECT a.id, a.room_id, a.uid, a.status, a.created_at, a.attendance_date
     FROM attendance a WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 60`,
    [user.id]
  );
  const todayRow = await db.query(
    `SELECT a.id, a.room_id, a.uid, a.status, a.created_at, a.attendance_date
     FROM attendance a WHERE a.user_id = $1 AND a.attendance_date = $2
     ORDER BY a.created_at DESC LIMIT 1`,
    [user.id, today]
  );
  return {
    ok: true,
    role: user.role,
    me: user,
    today,
    todayAttendance: todayRow.rows[0] || null,
    history: rows,
  };
}

async function guardianView(user) {
  const children = await accessibleStudents(user.id);
  const today = dhakaDate();
  const out = [];
  for (const child of children) {
    const { rows } = await db.query(
      `SELECT a.id, a.room_id, a.uid, a.status, a.created_at, a.attendance_date
       FROM attendance a WHERE a.user_id = $1 AND a.attendance_date = $2
       ORDER BY a.created_at DESC LIMIT 1`,
      [child.id, today]
    );
    const history = await db.query(
      `SELECT a.id, a.room_id, a.status, a.created_at, a.attendance_date
       FROM attendance a WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 30`,
      [child.id]
    );
    out.push({ child, today: rows[0] || null, arrivalTime: rows[0] ? rows[0].created_at : null, history: history.rows });
  }
  return { ok: true, role: user.role, me: user, today, children: out };
}

module.exports = { guardianView, online, overview, roomSnapshot, studentView };
