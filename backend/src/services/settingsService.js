const db = require('../db');
const config = require('../config');

// Overridable defaults. These are SEEDS stored in the settings table and are
// editable live from the dashboard / device — not fixed constants.
const DEFAULTS = {
  room_id: config.defaultRoomId,
  temp_threshold_c: 35,
  humidity_threshold_pct: 80,
  flame_response_limit_ms: 2000,
  door_auto_lock_ms: 8000,
  telemetry_interval_ms: 5000,
  command_poll_interval_ms: 3000,
};

async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

async function getAll() {
  const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function setMany(obj) {
  for (const [key, value] of Object.entries(obj)) {
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }
  return getAll();
}

module.exports = { DEFAULTS, ensureDefaults, getAll, setMany };