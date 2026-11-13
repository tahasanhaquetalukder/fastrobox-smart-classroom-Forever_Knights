const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const settings = require('../services/settingsService');

// Apply pending SQL migrations in filename order. Exported so tests can run the
// same files against an embedded PostgreSQL.
async function runMigrations(query) {
  const q = query || db.query;
  await q(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];

  for (const file of files) {
    const { rows } = await q('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await q('BEGIN');
    try {
      await q(sql);
      await q('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await q('COMMIT');
      applied.push(file);
    } catch (err) {
      await q('ROLLBACK').catch(() => {});
      throw err;
    }
  }
  return applied;
}

async function run() {
  console.log(`[migrate] host=${config.dbHost || '(unknown)'} ssl=${config.dbSsl ? 'on' : 'off'}`);
  const applied = await runMigrations(db.query);
  console.log(applied.length ? `[migrate] applied: ${applied.join(', ')}` : '[migrate] schema up to date');
  await settings.ensureDefaults();
  await settings.ensureRoomSeeds();
  console.log('[migrate] done; default settings and room ensured');
}

if (require.main === module) {
  run()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error(`[migrate] failed: code=${err.code || 'n/a'} message=${config.redact(err.message)}`);
      console.error('[migrate] hint: check SSL (DATABASE_SSL), URL host/port, network/firewall (port 5432), and that the database is awake.');
      process.exitCode = 1;
      db.pool.end();
    });
}

module.exports = { run, runMigrations };
