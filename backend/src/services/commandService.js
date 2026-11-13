const db = require('../db');
const { publish } = require('./eventBus');

async function create(deviceId, type, payload = {}, issuedBy = null) {
  const { rows } = await db.query(
    `INSERT INTO commands (device_id, type, payload, issued_by)
     VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
    [deviceId, type, JSON.stringify(payload), issuedBy || null]
  );
  publish('command', rows[0]);
  return rows[0];
}

// Return pending commands and mark them delivered (at-most-once delivery).
async function pendingFor(deviceId) {
  const { rows } = await db.query(
    `SELECT * FROM commands
     WHERE device_id = $1 AND status = 'pending'
     ORDER BY created_at ASC`,
    [deviceId]
  );
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await db.query(
      `UPDATE commands SET status = 'delivered', delivered_at = now()
       WHERE id = ANY($1::bigint[])`,
      [ids]
    );
  }
  return rows;
}

async function ack(deviceId, id, status = 'acked') {
  const { rows } = await db.query(
    `UPDATE commands SET status = $3, acked_at = now()
     WHERE id = $1 AND device_id = $2 RETURNING *`,
    [id, deviceId, status]
  );
  if (rows.length) publish('command', rows[0]);
  return rows[0] || null;
}

module.exports = { ack, create, pendingFor };
