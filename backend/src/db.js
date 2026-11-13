const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl || undefined,
  ssl: config.dbSsl,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', config.redact(err.message));
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  // Run fn inside a transaction on a dedicated client.
  async withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
};
