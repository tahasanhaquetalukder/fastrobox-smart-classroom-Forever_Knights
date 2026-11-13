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

function envBool(name, fallback = false) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
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
// Render's managed certificate.
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
  port: envInt('PORT', 3000, 1, 65535),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  databaseUrl,
  dbHost: hostOf(databaseUrl),
  dbSsl: resolveSsl(databaseUrl),

  // Device authentication.
  deviceToken: process.env.DEVICE_TOKEN || '',
  deviceBootstrapEnabled: envBool('DEVICE_BOOTSTRAP_ENABLED', false),

  // Legacy token access kept for tooling/judges; user accounts are preferred.
  adminToken: process.env.ADMIN_TOKEN || '',
  readToken: process.env.READ_TOKEN || '',

  // Rate limits.
  authFailureLimit: envInt('AUTH_FAILURE_LIMIT', 10, 1, 1000),
  writeLimit: envInt('WRITE_LIMIT', 120, 1, 10000),
  rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),

  // Login lockout: 5 wrong passwords -> 30 seconds.
  loginMaxFailures: envInt('LOGIN_MAX_FAILURES', 5, 1, 20),
  loginLockMs: envInt('LOGIN_LOCK_MS', 30000, 1000, 86400000),
  bcryptRounds: envInt('BCRYPT_ROUNDS', 10, 4, 15),
  sessionTtlHours: envInt('SESSION_TTL_HOURS', 12, 1, 720),

  // Seed only; runtime-editable via /api/settings.
  defaultRoomId: process.env.DEFAULT_ROOM_ID || 'ROOM-1',
  teamId: process.env.TEAM_ID || 'Forever_Knights',

  // Notifications. Nothing is sent unless a provider is fully configured.
  notifyProvider: (process.env.NOTIFY_PROVIDER || 'log').trim().toLowerCase(),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  notifyEmailFrom: process.env.NOTIFY_EMAIL_FROM || '',
  notifyEmailTo: process.env.NOTIFY_EMAIL_TO || '',

  redact,
};

module.exports = config;
