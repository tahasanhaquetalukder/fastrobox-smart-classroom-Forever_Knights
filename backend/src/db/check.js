// Quick connectivity probe: connect and run SELECT 1.
//   npm run db:check
// Prints ONLY the hostname and whether SSL is on — never the full DATABASE_URL,
// password, or any token.
const config = require('../config');
const db = require('../db');

async function run() {
  console.log(`[db:check] host=${config.dbHost || '(unknown)'} ssl=${config.dbSsl ? 'on' : 'off'}`);

  if (!config.databaseUrl) {
    console.error('[db:check] FAIL: DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exitCode = 1;
    return;
  }

  try {
    await db.query('SELECT 1 AS ok');
    console.log('[db:check] OK: connected and SELECT 1 succeeded.');
  } catch (err) {
    console.error(`[db:check] FAIL: code=${err.code || 'n/a'} message=${config.redact(err.message)}`);
    console.error('[db:check] hint: check SSL (DATABASE_SSL), URL host/port, network/firewall (port 5432), and that the Render DB is awake.');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

run();