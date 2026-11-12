const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl || undefined,
  ssl: config.pgSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};