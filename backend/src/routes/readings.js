const express = require('express');
const db = require('../db');
const { anyAuth, roomIdsForUser } = require('../middleware/userAuth');
const { asyncHandler, clampInt } = require('../util');

const router = express.Router();
router.use(anyAuth);

// GET /api/readings?roomId=&deviceId=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const where = [];
  const params = [];
  const user = req.user;

  if (user && user.role !== 'admin') {
    const ids = await roomIdsForUser(user);
    if (!ids.length) return res.json({ ok: true, readings: [] });
    params.push(ids);
    where.push(`room_id = ANY($${params.length}::text[])`);
  }
  if (req.query.roomId) { params.push(req.query.roomId); where.push(`room_id = $${params.length}`); }
  if (req.query.deviceId) { params.push(req.query.deviceId); where.push(`device_id = $${params.length}`); }
  params.push(limit);
  const sql = `SELECT * FROM sensor_readings
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await db.query(sql, params);
  res.json({ ok: true, readings: rows });
}));

module.exports = router;
