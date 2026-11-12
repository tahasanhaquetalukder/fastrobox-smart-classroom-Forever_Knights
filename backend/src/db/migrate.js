const fs = require('fs');
const path = require('path');
const db = require('../db');
const settings = require('../services/settingsService');

async function run() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`[migrate] apply ${file}`);
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }

  await settings.ensureDefaults();
  console.log('[migrate] done; default settings ensured');
}

run()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
    db.pool.end();
  });