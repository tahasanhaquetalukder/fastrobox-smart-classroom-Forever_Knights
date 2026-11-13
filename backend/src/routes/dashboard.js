const express = require('express');
const db = require('../db');
const dashboard = require('../services/dashboardService');
const { requireAuth, roomIdsForUser } = require('../middleware/userAuth');
const { asyncHandler } = require('../util');

const router = express.Router();

router.get(['/', '/summary'], requireAuth, asyncHandler(async (req, res) => {
  const user = req.user;

  if (user.role === 'student') return res.json(await dashboard.studentView(user));
  if (user.role === 'guardian') return res.json(await dashboard.guardianView(user));

  const ids = await roomIdsForUser(user);
  let rooms = [];
  if (ids.length) {
    const { rows } = await db.query(
      'SELECT room_id, name FROM rooms WHERE room_id = ANY($1::text[]) ORDER BY room_id',
      [ids]
    );
    rooms = rows.map((r) => ({ roomId: r.room_id, name: r.name }));
  }

  const requested = String(req.query.roomId || '').trim();
  if (requested && !ids.includes(requested)) {
    return res.status(403).json({ error: 'you do not have access to this room' });
  }

  res.json(await dashboard.overview(user, rooms, requested || null));
}));

// Full event history for the admin log view (role-scoped for teachers).
router.get('/events', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
  const user = req.user;
  const params = [];
  let scope = '';

  if (user.role !== 'admin') {
    const ids = await roomIdsForUser(user);
    if (!ids.length) return res.json({ ok: true, events: [] });
    params.push(ids);
    scope = `WHERE room_id = ANY($${params.length}::text[])`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT * FROM events ${scope} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json({ ok: true, events: rows });
}));

module.exports = router;
