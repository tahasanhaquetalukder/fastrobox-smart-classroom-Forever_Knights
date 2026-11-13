'use strict';

const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/db');
const config = require('../src/config');
const auth = require('../src/services/authService');
const devices = require('../src/services/deviceService');
const settings = require('../src/services/settingsService');
const { runMigrations } = require('../src/db/migrate');

// PGlite is a real PostgreSQL engine compiled to WASM running in-process, so
// migrations, constraints, partial indexes and ON CONFLICT behave like prod.
async function startTestApp() {
  config.bcryptRounds = 4;
  config.loginMaxFailures = 5;
  config.loginLockMs = 300;
  config.sessionTtlHours = 1;
  config.notifyProvider = 'log';
  config.readToken = '';
  config.adminToken = '';
  config.deviceToken = '';
  config.deviceBootstrapEnabled = false;

  const pg = new PGlite();
  db.query = async (text, params) => {
    // The migration runner sends whole files. PGlite's extended protocol only
    // accepts one statement, so multi-statement scripts go through exec().
    if (params === undefined && text.includes(';')) {
      await pg.exec(text);
      return { rows: [] };
    }
    return pg.query(text, params);
  };

  await runMigrations(db.query);
  await settings.ensureDefaults();
  await settings.ensureRoomSeeds();

  const app = require('../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { token, body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  async function seedUser(spec) {
    return auth.createUser(spec);
  }

  async function login(email, password) {
    const res = await request('POST', '/api/auth/login', { body: { email, password } });
    return res;
  }

  async function createDevice(deviceId, roomId) {
    return devices.createDevice({ deviceId, roomId, name: deviceId });
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    await pg.close();
  }

  return { pg, db, config, base, request, seedUser, login, createDevice, close };
}

module.exports = { startTestApp };
