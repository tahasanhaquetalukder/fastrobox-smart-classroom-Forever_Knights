'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const db = require('../src/db');
const { adminAuth } = require('../src/middleware/adminAuth');
const { readAuth } = require('../src/middleware/readAuth');
const { deviceAuth, sha256 } = require('../src/middleware/deviceAuth');
const { authRateLimit, writeRateLimit } = require('../src/middleware/rateLimit');
const devices = require('../src/services/deviceService');
const settings = require('../src/services/settingsService');

function mockResponse() {
  const listeners = {};
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; },
    on(event, handler) { listeners[event] = handler; },
    emit(event) { if (listeners[event]) listeners[event](); },
  };
}

function mockRequest(headers = {}, body = {}) {
  return {
    body,
    ip: `test-${Date.now()}-${Math.random()}`,
    method: 'GET',
    socket: {},
    get(name) { return headers[name.toLowerCase()] || ''; },
  };
}

function restore(t, values) {
  t.after(() => {
    for (const [object, key, value] of values) object[key] = value;
  });
}

test('adminAuth fails closed and accepts only the configured token', (t) => {
  restore(t, [[config, 'adminToken', config.adminToken]]);
  config.adminToken = '';
  let res = mockResponse();
  adminAuth(mockRequest(), res, () => assert.fail());
  assert.equal(res.statusCode, 503);

  config.adminToken = 'TEST-TOKEN';
  res = mockResponse();
  adminAuth(mockRequest(), res, () => assert.fail());
  assert.equal(res.statusCode, 401);
  res = mockResponse();
  adminAuth(mockRequest({ 'x-admin-token': 'invalid' }), res, () => assert.fail());
  assert.equal(res.statusCode, 401);

  let advanced = false;
  res = mockResponse();
  adminAuth(mockRequest({ 'x-admin-token': 'TEST-TOKEN' }), res, () => { advanced = true; });
  assert.equal(advanced, true);
});

test('readAuth accepts read or admin credentials and rejects invalid credentials', (t) => {
  restore(t, [
    [config, 'readToken', config.readToken],
    [config, 'adminToken', config.adminToken],
  ]);
  config.readToken = '';
  config.adminToken = '';
  let res = mockResponse();
  readAuth(mockRequest(), res, () => assert.fail());
  assert.equal(res.statusCode, 503);

  config.readToken = 'TEST-TOKEN';
  config.adminToken = 'TEST-TOKEN-ADMIN';
  for (const headers of [
    { 'x-read-token': 'TEST-TOKEN' },
    { 'x-admin-token': 'TEST-TOKEN-ADMIN' },
  ]) {
    let advanced = false;
    readAuth(mockRequest(headers), mockResponse(), () => { advanced = true; });
    assert.equal(advanced, true);
  }
  res = mockResponse();
  readAuth(mockRequest({ 'x-read-token': 'invalid' }), res, () => assert.fail());
  assert.equal(res.statusCode, 401);
});

test('deviceAuth accepts active tokens without exposing hashes and rejects revoked tokens', async (t) => {
  restore(t, [[db, 'query', db.query]]);
  const digest = sha256('TEST-TOKEN');
  db.query = async () => ({ rows: [{ device_id: 'node-1', token_hash: digest, revoked_at: null }] });
  const req = mockRequest({ authorization: 'Bearer TEST-TOKEN' });
  let advanced = false;
  await deviceAuth(req, mockResponse(), () => { advanced = true; });
  assert.equal(advanced, true);
  assert.equal(req.device.token_hash, undefined);

  db.query = async () => ({ rows: [{ device_id: 'node-1', token_hash: digest, revoked_at: new Date() }] });
  const res = mockResponse();
  await deviceAuth(mockRequest({ authorization: 'Bearer TEST-TOKEN' }), res, () => assert.fail());
  assert.equal(res.statusCode, 401);
});

test('deviceAuth keeps bootstrap off by default and requires device identity when enabled', async (t) => {
  restore(t, [
    [db, 'query', db.query],
    [config, 'deviceToken', config.deviceToken],
    [config, 'deviceBootstrapEnabled', config.deviceBootstrapEnabled],
    [config, 'defaultRoomId', config.defaultRoomId],
  ]);
  config.deviceToken = 'TEST-TOKEN';
  config.defaultRoomId = '';
  db.query = async () => ({ rows: [] });

  config.deviceBootstrapEnabled = false;
  let res = mockResponse();
  await deviceAuth(mockRequest({ authorization: 'Bearer TEST-TOKEN' }), res, () => assert.fail());
  assert.equal(res.statusCode, 401);

  config.deviceBootstrapEnabled = true;
  res = mockResponse();
  await deviceAuth(mockRequest({ authorization: 'Bearer TEST-TOKEN' }), res, () => assert.fail());
  assert.equal(res.statusCode, 400);
});

test('deviceAuth does not let shared bootstrap revive a revoked device', async (t) => {
  restore(t, [
    [db, 'query', db.query],
    [config, 'deviceToken', config.deviceToken],
    [config, 'deviceBootstrapEnabled', config.deviceBootstrapEnabled],
  ]);
  config.deviceToken = 'TEST-TOKEN';
  config.deviceBootstrapEnabled = true;
  let call = 0;
  db.query = async () => {
    call++;
    return call === 1 ? { rows: [] } : { rows: [{ device_id: 'node-1', revoked_at: new Date() }] };
  };
  const req = mockRequest({ authorization: 'Bearer TEST-TOKEN', 'x-device-id': 'node-1' }, { roomId: 'room-a' });
  const res = mockResponse();
  await deviceAuth(req, res, () => assert.fail());
  assert.equal(res.statusCode, 401);
});

test('device creation returns plaintext once and stores only its hash', async (t) => {
  restore(t, [[db, 'query', db.query]]);
  let storedHash;
  db.query = async (sql, params) => {
    storedHash = params[3];
    return { rows: [{ device_id: params[0], room_id: params[2] }] };
  };
  const result = await devices.createDevice({ deviceId: 'node-1', roomId: 'room-a', name: '' });
  assert.equal(storedHash, sha256(result.token));
  assert.notEqual(storedHash, result.token);
  assert.equal(result.device.token_hash, undefined);
});

test('token rotation stores a new hash and revocation clears access', async (t) => {
  restore(t, [[db, 'query', db.query]]);
  let call = 0;
  let rotatedHash;
  db.query = async (sql, params) => {
    call++;
    if (call === 1) return { rows: [{ revoked_at: null }] };
    rotatedHash = params[1];
    return { rows: [{ device_id: params[0], revoked_at: null }] };
  };
  const rotated = await devices.rotateDeviceToken('node-1');
  assert.equal(rotatedHash, sha256(rotated.token));
  assert.equal(rotated.device.token_hash, undefined);

  db.query = async (sql, params) => ({ rows: [{ device_id: params[0], revoked_at: new Date() }] });
  const revoked = await devices.revokeDevice('node-1');
  assert.equal(revoked.device_id, 'node-1');
  assert.equal(revoked.token_hash, undefined);
});

test('revoked devices cannot rotate tokens', async (t) => {
  restore(t, [[db, 'query', db.query]]);
  db.query = async () => ({ rows: [{ revoked_at: new Date() }] });
  await assert.rejects(devices.rotateDeviceToken('node-1'), (err) => err.status === 409);
});

test('rate limiters block repeated auth failures and writes', (t) => {
  restore(t, [
    [config, 'authFailureLimit', config.authFailureLimit],
    [config, 'writeLimit', config.writeLimit],
    [config, 'rateLimitWindowMs', config.rateLimitWindowMs],
  ]);
  config.authFailureLimit = 2;
  config.writeLimit = 2;
  config.rateLimitWindowMs = 60000;

  const authReq = mockRequest();
  for (let i = 0; i < 2; i++) {
    const res = mockResponse();
    authRateLimit(authReq, res, () => {});
    res.statusCode = 401;
    res.emit('finish');
  }
  const authRes = mockResponse();
  authRateLimit(authReq, authRes, () => assert.fail());
  assert.equal(authRes.statusCode, 429);

  const writeReq = mockRequest();
  writeReq.method = 'POST';
  for (let i = 0; i < 2; i++) writeRateLimit(writeReq, mockResponse(), () => {});
  const writeRes = mockResponse();
  writeRateLimit(writeReq, writeRes, () => assert.fail());
  assert.equal(writeRes.statusCode, 429);
});

test('settings validation rejects malformed writes before database access', async (t) => {
  restore(t, [[db, 'query', db.query]]);
  db.query = async () => assert.fail('validation must run before database access');
  for (const value of [
    {},
    { unknown: true },
    { temp_threshold_c: '35' },
    { humidity_threshold_pct: 101 },
    { telemetry_interval_ms: 100 },
  ]) {
    await assert.rejects(settings.setMany(value), (err) => err.status === 400);
  }
});
