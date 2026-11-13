const db = require('../db');
const config = require('../config');

const ALERT_TYPES = new Set(['FIRE', 'PANIC', 'HEAT_DANGER']);

function providerInfo() {
  const provider = config.notifyProvider;
  const ready = {
    log: false,
    none: false,
    telegram: Boolean(config.telegramBotToken && config.telegramChatId),
    webhook: Boolean(config.notifyWebhookUrl),
    email: Boolean(config.resendApiKey && config.notifyEmailFrom && config.notifyEmailTo),
  }[provider] === true;
  return {
    provider,
    configured: ready,
    note: ready
      ? 'Provider credentials detected; delivery attempts are recorded in notification_log.'
      : 'No notification provider is fully configured. Safety alerts are recorded but not delivered externally.',
  };
}

async function teacherRecipients(roomId) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.email, u.display_name
     FROM room_assignments ra JOIN users u ON u.id = ra.user_id
     WHERE ra.room_id = $1 AND ra.role = 'teacher' AND u.active = true`,
    [roomId]
  );
  return rows;
}

async function record(roomId, eventType, recipient, provider, status, detail) {
  await db.query(
    `INSERT INTO notification_log (room_id, event_type, recipient, provider, status, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [roomId || null, eventType, recipient || null, provider, status, detail || null]
  );
}

async function httpJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function deliver({ provider, roomId, eventType, message, recipients }) {
  if (provider === 'telegram') {
    await httpJson(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      { chat_id: config.telegramChatId, text: message }
    );
    await record(roomId, eventType, `telegram:${config.telegramChatId}`, provider, 'sent', message.slice(0, 200));
    return 1;
  }
  if (provider === 'webhook') {
    await httpJson(config.notifyWebhookUrl, { roomId, eventType, message, at: new Date().toISOString() });
    await record(roomId, eventType, 'webhook', provider, 'sent', message.slice(0, 200));
    return 1;
  }
  if (provider === 'email') {
    const to = [config.notifyEmailTo, ...recipients.map((r) => r.email)].filter(Boolean);
    const unique = [...new Set(to)];
    await httpJson(
      'https://api.resend.com/emails',
      {
        from: config.notifyEmailFrom,
        to: unique,
        subject: `[Smart Classroom] ${eventType} — ${roomId || 'unknown room'}`,
        text: message,
      },
      { Authorization: `Bearer ${config.resendApiKey}` }
    );
    await record(roomId, eventType, unique.join(','), provider, 'sent', message.slice(0, 200));
    return unique.length;
  }
  return 0;
}

// Notify assigned teachers for a safety event. Never pretends delivery worked:
// unconfigured providers record a `skipped` row and return delivered: 0.
async function notifySafety({ roomId, eventType, message }) {
  const info = providerInfo();
  const recipients = roomId ? await teacherRecipients(roomId) : [];

  if (!ALERT_TYPES.has(eventType) && eventType !== 'SENSOR_ERROR') {
    return { ...info, delivered: 0 };
  }

  if (!info.configured) {
    await record(roomId, eventType, recipients.map((r) => r.email).join(',') || null, info.provider, 'skipped',
      'provider is not configured');
    console.log(`[notify] ${eventType} room=${roomId || '-'} (not delivered: provider "${info.provider}" not configured)`);
    return { ...info, delivered: 0 };
  }

  try {
    const delivered = await deliver({ provider: info.provider, roomId, eventType, message, recipients });
    console.log(`[notify] ${eventType} room=${roomId || '-'} delivered=${delivered} via ${info.provider}`);
    return { ...info, delivered };
  } catch (err) {
    const detail = config.redact(err.message);
    await record(roomId, eventType, recipients.map((r) => r.email).join(',') || null, info.provider, 'failed', detail);
    console.error(`[notify] ${eventType} failed: ${detail}`);
    return { ...info, delivered: 0, error: 'notification delivery failed' };
  }
}

async function recent(limit = 50) {
  const { rows } = await db.query(
    'SELECT * FROM notification_log ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { notifySafety, providerInfo, recent };
