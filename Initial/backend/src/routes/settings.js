const express = require('express');
const settings = require('../services/settingsService');
const { adminAuth } = require('../middleware/adminAuth');
const { deviceOrReadAuth } = require('../middleware/readAuth');
const { publish } = require('../services/eventBus');
const { asyncHandler } = require('../util');

const router = express.Router();

// GET /api/settings — read/admin dashboard access or device access.
router.get('/', deviceOrReadAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, settings: await settings.getAll() });
}));

// PUT /api/settings — runtime edit (admin-guarded).
router.put('/', adminAuth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'expected a JSON object of key/value settings' });
  }
  const updated = await settings.setMany(body);
  publish('settings', updated);
  res.json({ ok: true, settings: updated });
}));

module.exports = router;