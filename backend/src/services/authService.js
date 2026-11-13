const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

let dummyHash = null;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    class_label: user.class_label,
  };
}

function badInput(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function validatePassword(password) {
  const value = typeof password === 'string' ? password : '';
  if (value.length < 8) throw badInput('password must be at least 8 characters');
  if (value.length > 72) throw badInput('password must be at most 72 characters');
  return value;
}

async function hashPassword(password) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hash(validatePassword(password), config.bcryptRounds);
}

async function recordLogin({ user, email, success, reason, ip, userAgent }) {
  await db.query(
    `INSERT INTO login_history (user_id, email, success, reason, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [user ? user.id : null, email || (user && user.email) || null, Boolean(success), reason || null, ip || null, userAgent || null]
  );
}

// Login with per-account lockout. All failures return the same message so the
// API does not reveal whether an account exists.
async function login({ email, password, ip, userAgent }) {
  const normalized = normalizeEmail(email);
  if (!normalized || typeof password !== 'string' || !password) {
    await recordLogin({ email: normalized, success: false, reason: 'malformed_input', ip, userAgent });
    return null;
  }

  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [normalized]);
  const user = rows[0];

  if (!user) {
    // Constant-ish work for unknown accounts to reduce timing leakage.
    const bcrypt = require('bcryptjs');
    if (!dummyHash) dummyHash = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);
    await bcrypt.compare(password, dummyHash).catch(() => false);
    await recordLogin({ email: normalized, success: false, reason: 'unknown_account', ip, userAgent });
    return null;
  }

  if (!user.active) {
    await recordLogin({ user, success: false, reason: 'inactive_account', ip, userAgent });
    return null;
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await recordLogin({ user, success: false, reason: 'locked', ip, userAgent });
    return null;
  }

  const bcrypt = require('bcryptjs');
  const ok = await bcrypt.compare(password, user.password_hash).catch(() => false);

  if (!ok) {
    const nextCount = user.failed_attempts + 1;
    const lockAt = nextCount >= config.loginMaxFailures
      ? new Date(Date.now() + config.loginLockMs)
      : user.locked_until;
    await db.query(
      'UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1',
      [user.id, nextCount, lockAt]
    );
    await recordLogin({ user, success: false, reason: 'bad_password', ip, userAgent });
    return null;
  }

  await db.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id]
  );
  await recordLogin({ user, success: true, reason: 'ok', ip, userAgent });

  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5)`,
    [hashToken(token), user.id, expires, ip || null, userAgent || null]
  );

  return { token, expires_at: expires.toISOString(), user: publicUser(user) };
}

async function resolveSession(token) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.class_label, u.active,
            s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return publicUser(row);
}

async function logout(token) {
  if (!token) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

async function createUser({ email, password, displayName, role, classLabel, active = true }) {
  if (!['admin', 'teacher', 'student', 'guardian'].includes(role)) {
    throw badInput('role must be admin, teacher, student or guardian');
  }
  const mail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw badInput('a valid email is required');
  const name = String(displayName || '').trim();
  if (!name) throw badInput('displayName is required');
  const passwordHash = await hashPassword(password);

  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, display_name, role, password_hash, class_label, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, display_name, role, class_label, active, created_at`,
      [mail, name, role, passwordHash, classLabel || null, Boolean(active)]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      err.status = 409;
      err.message = 'an account with that email already exists';
    }
    throw err;
  }
}

async function updateUser(id, patch = {}) {
  const sets = [];
  const params = [];
  const add = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };

  if (patch.displayName != null) add('display_name', String(patch.displayName).trim());
  if (patch.role != null) {
    if (!['admin', 'teacher', 'student', 'guardian'].includes(patch.role)) throw badInput('invalid role');
    add('role', patch.role);
  }
  if (patch.classLabel != null) add('class_label', String(patch.classLabel).trim() || null);
  if (patch.active != null) add('active', Boolean(patch.active));
  if (patch.password != null) add('password_hash', await hashPassword(patch.password));
  if (!sets.length) throw badInput('no supported fields to update');

  params.push(Number(id));
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, email, display_name, role, class_label, active, created_at`,
    params
  );
  if (!rows.length) {
    const err = new Error('user not found');
    err.status = 404;
    throw err;
  }
  if (patch.active === false || patch.password != null) {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [Number(id)]);
  }
  return rows[0];
}

module.exports = {
  hashPassword,
  hashToken,
  login,
  logout,
  normalizeEmail,
  publicUser,
  recordLogin,
  resolveSession,
  createUser,
  updateUser,
};
