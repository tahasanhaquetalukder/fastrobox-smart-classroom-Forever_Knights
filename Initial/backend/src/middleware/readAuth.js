const crypto = require('crypto');
const config = require('../config');
const { deviceAuth } = require('./deviceAuth');

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function readAuth(req, res, next) {
  if (!config.readToken && !config.adminToken) {
    return res.status(503).json({ error: 'read authentication is not configured' });
  }
  const readToken = (req.get('x-read-token') || '').trim();
  const adminToken = (req.get('x-admin-token') || '').trim();
  if (config.readToken && readToken && safeEqual(readToken, config.readToken)) {
    req.authRole = 'read';
    return next();
  }
  if (config.adminToken && adminToken && safeEqual(adminToken, config.adminToken)) {
    req.authRole = 'admin';
    return next();
  }
  return res.status(401).json({ error: 'valid read or admin token required' });
}

function deviceOrReadAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  if (authorization.startsWith('Bearer ') || req.get('x-device-token')) {
    return deviceAuth(req, res, next);
  }
  return readAuth(req, res, next);
}

module.exports = { deviceOrReadAuth, readAuth };
