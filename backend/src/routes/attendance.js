const express = require('express');
const db = require('../db');
const { anyAuth, roomIdsForUser } = require('../middleware/userAuth');
const { asyncHandler, clampInt } = require('../util');

const router = express.Router();
router.use(anyAuth);

// GET /api/attendance?roomId=&role=&limit=
// Students see only their own rows; guardians only their linked children.
router.get('/', asyncHandler(async (req, res) => {
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const where = [];
  const params = [];
  const user = req.user;

  if (user && user.role === 'student') {
    params.push(user.id);
    where.push(`user_id = $${params.length}`);
  } else if (user && user.role === 'guardian') {
    params.push(user.id);
    where.push(`user_id IN (SELECT student_id FROM guardian_links WHERE guardian_id = $${params.length})`);
  } else if (user && user.role !== 'admin') {
    const ids = await roomIdsForUser(user);
    if (!ids.length) return res.json({ ok: true, attendance: [] });
    params.push(ids);
    where.push(`room_id = ANY($${params.length}::text[])`);
  }

  if (req.query.roomId) { params.push(req.query.roomId); where.push(`room_id = $${params.length}`); }
  if (req.query.role) { params.push(req.query.role); where.push(`role = $${params.length}`); }
  params.push(limit);
  const sql = `SELECT * FROM attendance
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await db.query(sql, params);
  res.json({ ok: true, attendance: rows });
}));

module.exports = router;
