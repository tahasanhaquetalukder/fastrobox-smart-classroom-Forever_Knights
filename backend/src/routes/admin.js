const express = require('express');
const db = require('../db');
const auth = require('../services/authService');
const notifications = require('../services/notificationService');
const { requireAuth, requireRole } = require('../middleware/userAuth');
const { asyncHandler } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function text(value, field, max = 64) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > max) {
    const err = new Error(`${field} is required and must be at most ${max} characters`);
    err.status = 400;
    throw err;
  }
  return s;
}

router.get('/users', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.role) {
    params.push(String(req.query.role));
    where = 'WHERE role = $1';
  }
  const { rows } = await db.query(
    `SELECT id, email, display_name, role, class_label, active, last_login_at, created_at
     FROM users ${where} ORDER BY role, display_name`,
    params
  );
  res.json({ ok: true, users: rows });
}));

router.post('/users', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const user = await auth.createUser({
    email: body.email,
    password: body.password,
    displayName: body.displayName,
    role: body.role,
    classLabel: body.classLabel,
    active: body.active !== false,
  });
  res.status(201).json({ ok: true, user });
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const user = await auth.updateUser(req.params.id, req.body || {});
  res.json({ ok: true, user });
}));

router.get('/login-history', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
  const { rows } = await db.query(
    `SELECT lh.id, lh.user_id, lh.email, lh.success, lh.reason, lh.ip, lh.created_at,
            u.display_name
     FROM login_history lh LEFT JOIN users u ON u.id = lh.user_id
     ORDER BY lh.created_at DESC LIMIT $1`,
    [limit]
  );
  res.json({ ok: true, history: rows });
}));

router.get('/rooms', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.room_id, r.name, r.created_at,
            (SELECT count(*)::int FROM devices d WHERE d.room_id = r.room_id) AS device_count
     FROM rooms r ORDER BY r.room_id`
  );
  res.json({ ok: true, rooms: rows });
}));

router.post('/rooms', asyncHandler(async (req, res) => {
  const roomId = text(req.body && req.body.roomId, 'roomId');
  const { rows } = await db.query(
    `INSERT INTO rooms (room_id, name) VALUES ($1,$2)
     ON CONFLICT (room_id) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
    [roomId, (req.body && req.body.name) || roomId]
  );
  await db.query('INSERT INTO room_state (room_id) VALUES ($1) ON CONFLICT DO NOTHING', [roomId]);
  res.status(201).json({ ok: true, room: rows[0] });
}));

router.get('/rooms/:roomId/assignments', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ra.id, ra.room_id, ra.user_id, ra.role, u.email, u.display_name
     FROM room_assignments ra JOIN users u ON u.id = ra.user_id
     WHERE ra.room_id = $1 ORDER BY ra.role, u.display_name`,
    [req.params.roomId]
  );
  res.json({ ok: true, assignments: rows });
}));

router.post('/rooms/:roomId/assignments', asyncHandler(async (req, res) => {
  const userId = parseInt(req.body && req.body.userId, 10);
  const role = text(req.body && req.body.role, 'role', 16);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: 'userId must be an integer' });
  }
  const { rows } = await db.query(
    `INSERT INTO room_assignments (room_id, user_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *`,
    [req.params.roomId, userId, role]
  );
  res.status(201).json({ ok: true, assignment: rows[0] });
}));

router.delete('/rooms/:roomId/assignments/:userId', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM room_assignments WHERE room_id = $1 AND user_id = $2',
    [req.params.roomId, parseInt(req.params.userId, 10)]
  );
  res.json({ ok: true, deleted: rowCount });
}));

router.get('/cards', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.uid, c.role, c.active, c.label, c.created_at,
            u.id AS user_id, u.display_name, u.email
     FROM cards c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.uid`
  );
  res.json({ ok: true, cards: rows });
}));

router.post('/cards', asyncHandler(async (req, res) => {
  const uid = text(req.body && req.body.uid, 'uid', 32).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!uid) return res.status(400).json({ error: 'uid must be hex' });
  const userId = req.body.userId == null ? null : parseInt(req.body.userId, 10);
  const { rows } = await db.query(
    `INSERT INTO cards (uid, user_id, role, active, label) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (uid) DO UPDATE SET user_id = EXCLUDED.user_id, role = EXCLUDED.role,
       active = EXCLUDED.active, label = EXCLUDED.label RETURNING *`,
    [uid, Number.isFinite(userId) ? userId : null, req.body.role || 'student', req.body.active !== false, req.body.label || null]
  );
  res.status(201).json({ ok: true, card: rows[0] });
}));

router.delete('/cards/:uid', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM cards WHERE uid = $1', [String(req.params.uid).toUpperCase()]);
  res.json({ ok: true, deleted: rowCount });
}));

router.get('/notifications', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    provider: notifications.providerInfo(),
    notifications: await notifications.recent(Math.min(200, parseInt(req.query.limit, 10) || 50)),
  });
}));

router.get('/schedules', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.room_id, s.teacher_id, s.subject, s.day_of_week,
            to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time,
            u.display_name AS teacher_name
     FROM schedules s LEFT JOIN users u ON u.id = s.teacher_id
     ORDER BY s.day_of_week, s.start_time`
  );
  res.json({ ok: true, schedules: rows });
}));

router.post('/schedules', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const day = parseInt(b.dayOfWeek, 10);
  if (!Number.isFinite(day) || day < 1 || day > 7) {
    return res.status(400).json({ error: 'dayOfWeek must be 1 (Monday) to 7 (Sunday)' });
  }
  if (!/^\d{2}:\d{2}$/.test(String(b.startTime)) || !/^\d{2}:\d{2}$/.test(String(b.endTime))) {
    return res.status(400).json({ error: 'startTime and endTime must be HH:MM' });
  }
  const { rows } = await db.query(
    `INSERT INTO schedules (room_id, teacher_id, subject, day_of_week, start_time, end_time)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [text(b.roomId, 'roomId'), b.teacherId || null, b.subject || null, day, b.startTime, b.endTime]
  );
  res.status(201).json({ ok: true, schedule: rows[0] });
}));

router.delete('/schedules/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM schedules WHERE id = $1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true, deleted: rowCount });
}));

module.exports = router;
