const express = require('express');
const { adminAuth } = require('../middleware/adminAuth');
const devices = require('../services/deviceService');
const { asyncHandler } = require('../util');

const router = express.Router();
router.use(adminAuth);

function requiredText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    const err = new Error(`${field} is required and must be at most ${maxLength} characters`);
    err.status = 400;
    throw err;
  }
  return text;
}

function deviceIdParam(req) {
  return requiredText(req.params.id, 'device id', 64);
}

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await devices.createDevice({
    deviceId: requiredText(body.deviceId, 'deviceId', 64),
    roomId: requiredText(body.roomId, 'roomId', 64),
    name: body.name == null ? '' : requiredText(body.name, 'name', 100),
  });
  res.status(201).json({ ok: true, ...result });
}));

router.post('/:id/token', asyncHandler(async (req, res) => {
  const result = await devices.rotateDeviceToken(deviceIdParam(req));
  if (!result) return res.status(404).json({ error: 'device not found' });
  res.json({ ok: true, ...result });
}));

router.post('/:id/revoke', asyncHandler(async (req, res) => {
  const device = await devices.revokeDevice(deviceIdParam(req));
  if (!device) return res.status(404).json({ error: 'device not found' });
  res.json({ ok: true, device });
}));

module.exports = router;
