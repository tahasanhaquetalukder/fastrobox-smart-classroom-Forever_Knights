const db = require('../db');
const config = require('../config');

// Overridable defaults stored in the settings table. These are seeds editable
// live from the dashboard, not fixed constants.
const DEFAULTS = {
  room_id: config.defaultRoomId,
  temp_threshold_c: 32,
  humidity_threshold_pct: 85,
  danger_temp_c: 40,
  danger_exit_temp_c: 38,
  warn_exit_temp_c: 30,
  warn_exit_humidity_pct: 80,
  flame_response_limit_ms: 2000,
  fire_confirm_ms: 2000,
  panic_touch_ms: 2000,
  door_auto_lock_ms: 8000,
  telemetry_interval_ms: 5000,
  command_poll_interval_ms: 3000,
  student_uids: '',
  teacher_uids: '',
};

const RULES = {
  room_id: { type: 'string', maxLength: 64 },
  temp_threshold_c: { type: 'number', min: 0, max: 50 },
  humidity_threshold_pct: { type: 'number', min: 0, max: 100 },
  danger_temp_c: { type: 'number', min: 0, max: 60 },
  danger_exit_temp_c: { type: 'number', min: 0, max: 60 },
  warn_exit_temp_c: { type: 'number', min: 0, max: 60 },
  warn_exit_humidity_pct: { type: 'number', min: 0, max: 100 },
  flame_response_limit_ms: { type: 'number', min: 1, max: 600000, integer: true },
  fire_confirm_ms: { type: 'number', min: 1, max: 600000, integer: true },
  panic_touch_ms: { type: 'number', min: 1, max: 600000, integer: true },
  door_auto_lock_ms: { type: 'number', min: 1, max: 3600000, integer: true },
  telemetry_interval_ms: { type: 'number', min: 1000, max: 3600000, integer: true },
  command_poll_interval_ms: { type: 'number', min: 250, max: 3600000, integer: true },
  student_uids: { type: 'string', maxLength: 2048, allowEmpty: true },
  teacher_uids: { type: 'string', maxLength: 2048, allowEmpty: true },
};

function validateSettings(obj) {
  const entries = Object.entries(obj);
  if (!entries.length) {
    const err = new Error('at least one setting is required');
    err.status = 400;
    throw err;
  }
  const out = {};
  for (const [key, value] of entries) {
    const rule = RULES[key];
    if (!rule) {
      const err = new Error(`unknown setting: ${key}`);
      err.status = 400;
      throw err;
    }
    if (rule.type === 'string') {
      if (typeof value !== 'string' || (!rule.allowEmpty && !value.trim()) || value.length > rule.maxLength) {
        const err = new Error(`${key} must be ${rule.allowEmpty ? 'a string' : 'a non-empty string'} of at most ${rule.maxLength} characters`);
        err.status = 400;
        throw err;
      }
      out[key] = value.trim();
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max
        || (rule.integer && !Number.isInteger(value))) {
      const err = new Error(`${key} must be ${rule.integer ? 'an integer' : 'a number'} between ${rule.min} and ${rule.max}`);
      err.status = 400;
      throw err;
    }
    out[key] = value;
  }
  return out;
}

async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

async function ensureRoomSeeds() {
  await db.query(
    `INSERT INTO rooms (room_id, name) VALUES ($1, $1)
     ON CONFLICT (room_id) DO NOTHING`,
    [config.defaultRoomId]
  );
  await db.query(
    `INSERT INTO room_state (room_id) VALUES ($1)
     ON CONFLICT (room_id) DO NOTHING`,
    [config.defaultRoomId]
  );
}

async function getAll() {
  const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function setMany(obj) {
  const validated = validateSettings(obj);
  for (const [key, value] of Object.entries(validated)) {
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }
  return getAll();
}

module.exports = { DEFAULTS, RULES, ensureDefaults, ensureRoomSeeds, getAll, setMany, validateSettings };
