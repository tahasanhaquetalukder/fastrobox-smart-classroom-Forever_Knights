const db = require('../db');
const config = require('../config');
const auth = require('../services/authService');
const { readAuth, safeEqual } = require('./readAuth');

function sessionToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return (req.get('x-session-token') || '').trim();
}

function legacyAdmin(req) {
  const token = (req.get('x-admin-token') || '').trim();
  if (config.adminToken && token && safeEqual(token, config.adminToken)) {
    return { id: null, email: 'legacy-admin', display_name: 'Operator', role: 'admin', class_label: null, legacy: true };
  }
  return null;
}

// Resolve a user session (or the legacy admin token) and attach req.user.
async function requireAuth(req, res, next) {
  try {
    const token = sessionToken(req);
    if (token) {
      const user = await auth.resolveSession(token);
      if (!user) return res.status(401).json({ error: 'session expired or invalid' });
      req.user = user;
      req.sessionToken = token;
      return next();
    }
    const admin = legacyAdmin(req);
    if (admin) {
      req.user = admin;
      return next();
    }
    return res.status(401).json({ error: 'authentication required' });
  } catch (err) {
    next(err);
  }
}

// Accepts a user session, the legacy admin token, or the legacy read token.
// Read-token callers are read-only and must not use this on mutation routes.
async function anyAuth(req, res, next) {
  try {
    const token = sessionToken(req);
    if (token) {
      const user = await auth.resolveSession(token);
      if (!user) return res.status(401).json({ error: 'session expired or invalid' });
      req.user = user;
      req.sessionToken = token;
      return next();
    }
    const admin = legacyAdmin(req);
    if (admin) {
      req.user = admin;
      return next();
    }
    if (!config.readToken && !config.adminToken) {
      return res.status(401).json({ error: 'authentication required' });
    }
    return readAuth(req, res, next);
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'insufficient role for this action' });
    }
    return next();
  };
}

async function roomIdsForUser(user) {
  if (!user) return [];
  if (user.role === 'admin') {
    const { rows } = await db.query('SELECT room_id FROM rooms ORDER BY room_id');
    return rows.map((r) => r.room_id);
  }
  if (user.role === 'teacher' || user.role === 'student') {
    const { rows } = await db.query(
      'SELECT room_id FROM room_assignments WHERE user_id = $1 ORDER BY room_id',
      [user.id]
    );
    return rows.map((r) => r.room_id);
  }
  if (user.role === 'guardian') {
    const { rows } = await db.query(
      `SELECT DISTINCT ra.room_id
       FROM guardian_links gl
       JOIN room_assignments ra ON ra.user_id = gl.student_id
       WHERE gl.guardian_id = $1
       ORDER BY ra.room_id`,
      [user.id]
    );
    return rows.map((r) => r.room_id);
  }
  return [];
}

async function canAccessRoom(user, roomId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const rooms = await roomIdsForUser(user);
  return rooms.includes(roomId);
}

async function assertRoomAccess(req, roomId) {
  const ok = await canAccessRoom(req.user, roomId);
  if (!ok) {
    const err = new Error('you do not have access to this room');
    err.status = 403;
    throw err;
  }
}

async function accessibleStudents(guardianId) {
  const { rows } = await db.query(
    `SELECT u.id, u.display_name, u.email, u.class_label
     FROM guardian_links gl JOIN users u ON u.id = gl.student_id
     WHERE gl.guardian_id = $1 ORDER BY u.display_name`,
    [guardianId]
  );
  return rows;
}

module.exports = {
  accessibleStudents,
  anyAuth,
  assertRoomAccess,
  canAccessRoom,
  legacyAdmin,
  requireAuth,
  requireRole,
  roomIdsForUser,
  sessionToken,
};
