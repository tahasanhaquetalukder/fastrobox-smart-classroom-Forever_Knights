const express = require('express');
const settings = require('../services/settingsService');
const { adminAuth } = require('../middleware/adminAuth');
const { publish } = require('../services/eventBus');
const { asyncHandler } = require('../util');

const router = express.Router();

// GET /api/settings — public read (device + dashboard).
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, settings: await settings.getAll() });
}));

// PUT /api/settings — runtime edit (optionally admin-guarded).
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