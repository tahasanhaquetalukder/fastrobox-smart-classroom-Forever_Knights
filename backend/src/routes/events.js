const express = require('express');
const db = require('../db');
const { asyncHandler, clampInt } = require('../util');

const router = express.Router();

// GET /api/events?roomId=&deviceId=&type=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const where = [];
  const params = [];
  if (req.query.roomId) { params.push(req.query.roomId); where.push(`room_id = $${params.length}`); }
  if (req.query.deviceId) { params.push(req.query.deviceId); where.push(`device_id = $${params.length}`); }
  if (req.query.type) { params.push(req.query.type); where.push(`type = $${params.length}`); }
  params.push(limit);
  const sql = `SELECT * FROM events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await db.query(sql, params);
  res.json({ ok: true, events: rows });
}));

module.exports = router;