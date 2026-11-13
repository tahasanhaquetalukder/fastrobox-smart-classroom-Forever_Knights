const express = require('express');
const auth = require('../services/authService');
const { requireAuth, roomIdsForUser } = require('../middleware/userAuth');
const { asyncHandler } = require('../util');
const { authRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// POST /api/auth/login { email, password }
router.post('/login', authRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await auth.login({
    email,
    password,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  });
  if (!result) {
    // Same response for unknown account, wrong password and active lock.
    return res.status(401).json({ error: 'invalid credentials or account temporarily locked' });
  }
  res.json({ ok: true, ...result });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : (req.get('x-session-token') || '').trim();
  await auth.logout(token);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    user: req.user,
    rooms: await roomIdsForUser(req.user),
    permissions: {
      manage: req.user.role === 'admin',
      resetFire: req.user.role === 'admin' || req.user.role === 'teacher',
      viewRoom: ['admin', 'teacher'].includes(req.user.role),
    },
  });
}));

module.exports = router;
