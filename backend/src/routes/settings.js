const express = require('express');
const settings = require('../services/settingsService');
const { deviceAuth } = require('../middleware/deviceAuth');
const { requireAuth, requireRole, anyAuth } = require('../middleware/userAuth');
const { publish } = require('../services/eventBus');
const { asyncHandler } = require('../util');

const router = express.Router();

function hasDeviceToken(req) {
  return Boolean(req.get('x-device-token'));
}

// GET /api/settings — device token, user session, or legacy read/admin token.
router.get('/', (req, res, next) => {
  if (hasDeviceToken(req)) return deviceAuth(req, res, next);
  return anyAuth(req, res, next);
}, asyncHandler(async (req, res) => {
  res.json({ ok: true, settings: await settings.getAll() });
}));

// PUT /api/settings — admin only (user session or legacy admin token).
router.put('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'expected a JSON object of key/value settings' });
  }
  const updated = await settings.setMany(body);
  publish('settings', updated);
  res.json({ ok: true, settings: updated });
}));

module.exports = router;
