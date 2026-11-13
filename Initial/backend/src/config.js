const path = require('path');
const dotenv = require('dotenv');

// Load .env from the repo root (backend/src -> ../../). On Render the env vars
// are already present and dotenv does not override existing process.env.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL || '';

function envInt(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

// Hostname only — safe to log. The full URL embeds credentials, so never log it.
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isLocalHost(host) {
  return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// SSL policy: DATABASE_SSL=true/false forces it; otherwise auto-enable for any
// non-local host. Render's External URL requires SSL — a plaintext socket there
// is reset by the server (read ECONNRESET). rejectUnauthorized:false accepts
// Render's managed certificate for the demo.
function resolveSsl(url) {
  const override = String(process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(override)) return { rejectUnauthorized: false };
  if (['false', '0', 'no'].includes(override)) return false;
  const host = hostOf(url);
  return host && !isLocalHost(host) ? { rejectUnauthorized: false } : false;
}

// Strip credentials before printing error text: replace the full URL and the
// password substring so secrets never reach logs.
function redact(str) {
  let out = String(str == null ? '' : str);
  if (databaseUrl) {
    out = out.split(databaseUrl).join('[redacted-url]');
    try {
      const pw = new URL(databaseUrl).password;
      if (pw) out = out.split(pw).join('***');
    } catch {
      // URL not parseable; the full-string replacement above still protects it.
    }
  }
  return out;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl,
  dbHost: hostOf(databaseUrl),
  dbSsl: resolveSsl(databaseUrl),
  deviceToken: process.env.DEVICE_TOKEN || '',
  deviceBootstrapEnabled: String(process.env.DEVICE_BOOTSTRAP_ENABLED || '').trim().toLowerCase() === 'true',
  adminToken: process.env.ADMIN_TOKEN || '',
  readToken: process.env.READ_TOKEN || '',
  authFailureLimit: envInt('AUTH_FAILURE_LIMIT', 10, 1, 1000),
  writeLimit: envInt('WRITE_LIMIT', 120, 1, 10000),
  rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
  defaultRoomId: process.env.DEFAULT_ROOM_ID || '',
  redact,
};

module.exports = config;