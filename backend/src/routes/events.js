const express = require('express');
const db = require('../db');
const { anyAuth, roomIdsForUser } = require('../middleware/userAuth');
const { asyncHandler, clampInt } = require('../util');

const router = express.Router();
router.use(anyAuth);

const TYPE_ALIASES = { rfid_scan: 'CARD_TAP', flame_alert: 'FIRE', flame_clear: 'FIRE_CLEARED', boot: 'BOOT' };

// GET /api/events?roomId=&deviceId=&type=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const where = [];
  const params = [];
  const user = req.user;

  if (user && user.role !== 'admin') {
    const ids = await roomIdsForUser(user);
    if (!ids.length && user.role !== 'student' && user.role !== 'guardian') {
      return res.json({ ok: true, events: [] });
    }
    if (ids.length) {
      params.push(ids);
      where.push(`room_id = ANY($${params.length}::text[])`);
    }
  }
  if (req.query.roomId) { params.push(req.query.roomId); where.push(`room_id = $${params.length}`); }
  if (req.query.deviceId) { params.push(req.query.deviceId); where.push(`device_id = $${params.length}`); }
  if (req.query.type) {
    const t = String(req.query.type).toLowerCase();
    params.push(TYPE_ALIASES[t] || String(req.query.type).toUpperCase());
    where.push(`type = $${params.length}`);
  }
  params.push(limit);
  const sql = `SELECT * FROM events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await db.query(sql, params);
  res.json({ ok: true, events: rows });
}));

module.exports = router;
