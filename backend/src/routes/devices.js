const express = require('express');
const devices = require('../services/deviceService');
const { requireAuth, requireRole } = require('../middleware/userAuth');
const { asyncHandler } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function requiredText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    const err = new Error(`${field} is required and must be at most ${maxLength} characters`);
    err.status = 400;
    throw err;
  }
  return text;
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, devices: await devices.listDevices() });
}));

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
  const result = await devices.rotateDeviceToken(requiredText(req.params.id, 'device id', 64));
  if (!result) return res.status(404).json({ error: 'device not found' });
  res.json({ ok: true, ...result });
}));

router.post('/:id/revoke', asyncHandler(async (req, res) => {
  const device = await devices.revokeDevice(requiredText(req.params.id, 'device id', 64));
  if (!device) return res.status(404).json({ error: 'device not found' });
  res.json({ ok: true, device });
}));

module.exports = router;
