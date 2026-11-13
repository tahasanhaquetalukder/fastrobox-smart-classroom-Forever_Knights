'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');

let app;
let admin;
let teacher;
let student1;
let student2;
let guardian;
let device;
let studentToken;

const ROOM = 'ROOM-1';

test.before(async () => {
  app = await startTestApp();

  admin = await app.seedUser({
    email: 'admin@test.local', password: 'DUMMY_AdminPass1', displayName: 'Admin', role: 'admin',
  });
  teacher = await app.seedUser({
    email: 'teacher@test.local', password: 'DUMMY_TeacherPass1', displayName: 'Teacher', role: 'teacher', classLabel: '8-A',
  });
  student1 = await app.seedUser({
    email: 's1@test.local', password: 'DUMMY_StudentPass1', displayName: 'Student S1', role: 'student', classLabel: '8-A',
  });
  student2 = await app.seedUser({
    email: 's2@test.local', password: 'DUMMY_StudentPass2', displayName: 'Student S2', role: 'student', classLabel: '8-A',
  });
  guardian = await app.seedUser({
    email: 'guardian@test.local', password: 'DUMMY_GuardianPass1', displayName: 'Guardian S1', role: 'guardian',
  });

  await app.db.query(
    'INSERT INTO room_assignments (room_id, user_id, role) VALUES ($1,$2,$3),($1,$4,$3)',
    [ROOM, teacher.id, 'teacher', student1.id]
  );
  await app.db.query(
    'INSERT INTO room_assignments (room_id, user_id, role) VALUES ($1,$2,$3)',
    [ROOM, student2.id, 'student']
  );
  await app.db.query(
    'INSERT INTO guardian_links (guardian_id, student_id) VALUES ($1,$2)',
    [guardian.id, student1.id]
  );
  await app.db.query(
    `INSERT INTO cards (uid, user_id, role, label) VALUES
       ('AA11BB22', $1, 'student', 'S1 card'),
       ('CC33DD44', $2, 'student', 'S2 card')`,
    [student1.id, student2.id]
  );

  device = await app.createDevice('classroom-01', ROOM);

  const s1 = await app.login('s1@test.local', 'DUMMY_StudentPass1');
  studentToken = s1.body.token;
});

test.after(async () => {
  if (app) await app.close();
});

test('migrations create the Level 1-4 schema and default settings', async () => {
  const tables = await app.db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const names = tables.rows.map((r) => r.table_name);
  for (const expected of ['devices', 'sensor_readings', 'events', 'users', 'sessions', 'login_history', 'cards', 'attendance', 'room_state', 'notification_log']) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
  const settings = await app.db.query("SELECT value FROM settings WHERE key = 'danger_temp_c'");
  assert.equal(Number(settings.rows[0].value), 40);
});

test('health endpoint and dashboard shell are served', async () => {
  const health = await app.request('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.db, 'up');

  const page = await app.request('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /Smart Classroom/i);
});

test('protected endpoints reject unauthenticated requests', async () => {
  for (const path of ['/api/dashboard', '/api/admin/users', '/api/readings', '/api/events', '/api/door']) {
    const res = await app.request('GET', path);
    assert.equal(res.status, 401, `${path} should be 401`);
  }
  const deviceRes = await app.request('POST', '/api/device/telemetry', {
    body: { roomId: ROOM, temp_c: 25, rh: 50 },
  });
  assert.equal(deviceRes.status, 401);
});

test('admin login, session identity and role-based access control', async () => {
  const login = await app.login('admin@test.local', 'DUMMY_AdminPass1');
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  const token = login.body.token;

  const me = await app.request('GET', '/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'admin');

  const users = await app.request('GET', '/api/admin/users', { token });
  assert.equal(users.status, 200);
  assert.ok(users.body.users.length >= 5);

  const teacherLogin = await app.login('teacher@test.local', 'DUMMY_TeacherPass1');
  const forbidden = await app.request('GET', '/api/admin/users', { token: teacherLogin.body.token });
  assert.equal(forbidden.status, 403);

  const studentForbidden = await app.request('GET', '/api/admin/users', { token: studentToken });
  assert.equal(studentForbidden.status, 403);
});

test('login locks an account for 30s-style window after five failures', async () => {
  for (let i = 0; i < 5; i++) {
    const bad = await app.login('s2@test.local', 'wrong-password');
    assert.equal(bad.status, 401);
  }
  const stillBlocked = await app.login('s2@test.local', 'DUMMY_StudentPass2');
  assert.equal(stillBlocked.status, 401, 'correct password must not bypass an active lock');

  await new Promise((resolve) => setTimeout(resolve, 350));
  const recovered = await app.login('s2@test.local', 'DUMMY_StudentPass2');
  assert.equal(recovered.status, 200);

  const history = await app.db.query(
    "SELECT reason FROM login_history WHERE email = 's2@test.local' ORDER BY id DESC LIMIT 3"
  );
  assert.ok(history.rows.some((r) => r.reason === 'locked' || r.reason === 'bad_password'));
});

test('unknown accounts receive the same failure message as wrong passwords', async () => {
  const unknown = await app.login('nobody@test.local', 'whatever123');
  assert.equal(unknown.status, 401);
  assert.match(unknown.body.error, /invalid credentials/i);
});

test('device telemetry is validated, stores judged fields and rejects replays', async () => {
  const token = device.token;
  const now = Math.floor(Date.now() / 1000);

  const ok = await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': token },
    body: {
      seq: 1, ts: now, uptime_s: 120, temp_c: 27.5, rh: 55, flame: false,
      door: 'LOCKED', status: 'SAFE', heat_trend: 'STABLE', rssi: -52,
      heap_kb: 210.5, chip_temp_c: 41.2, fw: '2.0.0', quality: 'good',
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(Number(ok.body.reading.seq), 1);
  assert.ok(ok.body.reading.heat_index_c != null);
  assert.equal(ok.body.reading.quality, 'good');

  const replay = await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': token },
    body: { seq: 1, ts: now, temp_c: 27.6, rh: 55 },
  });
  assert.equal(replay.status, 409);

  const badRange = await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': token },
    body: { seq: 2, temp_c: 99, rh: 50 },
  });
  assert.equal(badRange.status, 400);

  const invalidSensors = await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': token },
    body: { seq: 3, ts: now, temp_c: -5, rh: 50, quality: 'good', status: 'SAFE' },
  });
  assert.equal(invalidSensors.status, 200);
  assert.equal(invalidSensors.body.reading.quality, 'bad');
});

test('device health is exposed through the dashboard summary', async () => {
  const login = await app.login('admin@test.local', 'DUMMY_AdminPass1');
  const res = await app.request('GET', `/api/dashboard?roomId=${ROOM}`, { token: login.body.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.snapshot.device.online, true);
  assert.equal(res.body.snapshot.device.fw, '2.0.0');
  assert.equal(Number(res.body.snapshot.device.rssi), -52);
  assert.ok(res.body.snapshot.latest.temp_c != null);
  assert.equal(res.body.notifications.provider, 'log');
  assert.equal(res.body.notifications.configured, false);
});

test('card taps create attendance once per day and unknown cards are flagged', async () => {
  const token = device.token;
  const tap = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'CARD_TAP', seq: 100, ts: Math.floor(Date.now() / 1000), payload: { uid: 'AA11BB22', accepted: true } },
  });
  assert.equal(tap.status, 200);
  assert.equal(tap.body.saved, 1);

  const att = await app.db.query('SELECT * FROM attendance WHERE user_id = $1', [student1.id]);
  assert.equal(att.rows.length, 1);
  assert.equal(att.rows[0].uid, 'AA11BB22');

  const again = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'CARD_TAP', seq: 101, ts: Math.floor(Date.now() / 1000), payload: { uid: 'AA11BB22', accepted: true } },
  });
  assert.equal(again.status, 200);
  const attAgain = await app.db.query('SELECT * FROM attendance WHERE user_id = $1', [student1.id]);
  assert.equal(attAgain.rows.length, 1, 'arrival recorded once per day');

  const unknown = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'CARD_TAP', seq: 102, ts: Math.floor(Date.now() / 1000), payload: { uid: 'DEADBEEF', accepted: true } },
  });
  assert.equal(unknown.status, 200);
  const unknownEv = await app.db.query("SELECT * FROM events WHERE type = 'UNKNOWN_CARD'");
  assert.equal(unknownEv.rows.length, 1);

  const studentDash = await app.request('GET', '/api/dashboard', { token: studentToken });
  assert.equal(studentDash.status, 200);
  assert.ok(studentDash.body.todayAttendance);
  assert.equal(studentDash.body.todayAttendance.uid, 'AA11BB22');
});

test('duplicate event sequence is rejected per event without dropping the batch', async () => {
  const token = device.token;
  const res = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: {
      events: [
        { type: 'STATUS', seq: 200, payload: { status: 'SAFE' } },
        { type: 'STATUS', seq: 200, payload: { status: 'SAFE' } },
        { type: 'SENSOR_ERROR', seq: 201, payload: { sensor: 'DHT11' } },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.saved, 2);
  assert.equal(res.body.rejected, 1);
  assert.equal(res.body.results[1].status, 409);
});

test('FIRE latches the room, notifies, unlocks the reset path only after flame clears', async () => {
  const token = device.token;
  const now = Math.floor(Date.now() / 1000);

  await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': token },
    body: { seq: 300, ts: now, temp_c: 45, rh: 50, flame: true, door: 'UNLOCKED', status: 'FIRE' },
  });

  const fire = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'FIRE', seq: 301, ts: now, payload: { active: true } },
  });
  assert.equal(fire.status, 200);

  const state = await app.db.query('SELECT * FROM room_state WHERE room_id = $1', [ROOM]);
  assert.equal(state.rows[0].fire_latched, true);
  assert.equal(state.rows[0].status, 'FIRE');

  const teacherLogin = await app.login('teacher@test.local', 'DUMMY_TeacherPass1');
  const blocked = await app.request('POST', '/api/fire/reset', {
    token: teacherLogin.body.token,
    body: { roomId: ROOM },
  });
  assert.equal(blocked.status, 409, 'flame still present');

  const blockedSilence = await app.request('POST', '/api/fire/silence', {
    token: teacherLogin.body.token,
    body: { roomId: ROOM },
  });
  assert.equal(blockedSilence.status, 409);

  await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': token },
    body: { seq: 302, ts: now, temp_c: 30, rh: 50, flame: false, status: 'SAFE' },
  });
  const cleared = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'FIRE_CLEARED', seq: 303, ts: now, payload: { active: false } },
  });
  assert.equal(cleared.status, 200);
  const latched = await app.db.query('SELECT * FROM room_state WHERE room_id = $1', [ROOM]);
  assert.equal(latched.rows[0].fire_latched, true);
  assert.equal(latched.rows[0].status, 'FIRE', 'latch keeps the room in FIRE until reset');

  const silence = await app.request('POST', '/api/fire/silence', {
    token: teacherLogin.body.token,
    body: { roomId: ROOM },
  });
  assert.equal(silence.status, 200);

  const reset = await app.request('POST', '/api/fire/reset', {
    token: teacherLogin.body.token,
    body: { roomId: ROOM },
  });
  assert.equal(reset.status, 200);

  const after = await app.db.query('SELECT * FROM room_state WHERE room_id = $1', [ROOM]);
  assert.equal(after.rows[0].fire_latched, false);

  const notification = await app.db.query("SELECT * FROM notification_log WHERE event_type = 'FIRE'");
  assert.ok(notification.rows.length >= 1);
  assert.equal(notification.rows[0].status, 'skipped');
});

test('PANIC honours the explicit active flag instead of toggling', async () => {
  const token = device.token;
  const now = Math.floor(Date.now() / 1000);

  const on = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'PANIC', seq: 410, ts: now, payload: { active: true } },
  });
  assert.equal(on.status, 200);
  let state = await app.request('GET', '/api/fire/state?roomId=' + ROOM, {
    token: (await app.login('teacher@test.local', 'DUMMY_TeacherPass1')).body.token,
  });
  assert.equal(state.body.state.panic_active, true);
  assert.equal(state.body.state.status, 'PANIC');

  // A second active:true must be idempotent, not a toggle back to SAFE.
  const repeat = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'PANIC', seq: 411, ts: now, payload: { active: true } },
  });
  assert.equal(repeat.status, 200);

  const off = await app.request('POST', '/api/device/events', {
    headers: { 'X-Device-Token': token },
    body: { type: 'PANIC', seq: 412, ts: now, payload: { active: false } },
  });
  assert.equal(off.status, 200);
  state = await app.request('GET', '/api/fire/state?roomId=' + ROOM, {
    token: (await app.login('teacher@test.local', 'DUMMY_TeacherPass1')).body.token,
  });
  assert.equal(state.body.state.panic_active, false);
  assert.equal(state.body.state.status, 'SAFE');
});

test('teacher role cannot reset fire in an unassigned room', async () => {
  await app.db.query("INSERT INTO rooms (room_id, name) VALUES ('ROOM-2', 'Other')");
  await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': device.token },
    body: { seq: 400, room_id: 'ROOM-2', temp_c: 45, rh: 50, flame: true, status: 'FIRE' },
  });
  const teacherLogin = await app.login('teacher@test.local', 'DUMMY_TeacherPass1');
  const res = await app.request('POST', '/api/fire/reset', {
    token: teacherLogin.body.token,
    body: { roomId: 'ROOM-2' },
  });
  assert.equal(res.status, 403, 'teacher session cannot reset another room');
});

test('guardian sees only linked children and their arrival', async () => {
  const login = await app.login('guardian@test.local', 'DUMMY_GuardianPass1');
  const res = await app.request('GET', '/api/dashboard', { token: login.body.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.children.length, 1);
  assert.equal(res.body.children[0].child.id, student1.id);
  assert.ok(res.body.children[0].arrivalTime);
});

test('settings writes are validated and restricted to admin', async () => {
  const teacherLogin = await app.login('teacher@test.local', 'DUMMY_TeacherPass1');
  const forbidden = await app.request('PUT', '/api/settings', {
    token: teacherLogin.body.token,
    body: { temp_threshold_c: 33 },
  });
  assert.equal(forbidden.status, 403);

  const adminLogin = await app.login('admin@test.local', 'DUMMY_AdminPass1');
  const invalid = await app.request('PUT', '/api/settings', {
    token: adminLogin.body.token,
    body: { humidity_threshold_pct: 101 },
  });
  assert.equal(invalid.status, 400);

  const valid = await app.request('PUT', '/api/settings', {
    token: adminLogin.body.token,
    body: { temp_threshold_c: 33 },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.settings.temp_threshold_c, 33);
});

test('device tokens are hashed, rotatable and revocable', async () => {
  const stored = await app.db.query('SELECT token_hash FROM devices WHERE device_id = $1', [device.device.device_id]);
  assert.notEqual(stored.rows[0].token_hash, device.token);

  const adminLogin = await app.login('admin@test.local', 'DUMMY_AdminPass1');
  const rotated = await app.request('POST', `/api/devices/${device.device.device_id}/token`, { token: adminLogin.body.token });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.body.token);
  assert.notEqual(rotated.body.token, device.token);

  const oldToken = await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': device.token },
    body: { seq: 500, temp_c: 25, rh: 50 },
  });
  assert.equal(oldToken.status, 401);

  const revoked = await app.request('POST', `/api/devices/${device.device.device_id}/revoke`, { token: adminLogin.body.token });
  assert.equal(revoked.status, 200);
  const afterRevoke = await app.request('POST', '/api/device/telemetry', {
    headers: { 'X-Device-Token': rotated.body.token },
    body: { seq: 501, temp_c: 25, rh: 50 },
  });
  assert.equal(afterRevoke.status, 401);
});

test('heat index calculation matches the Rothfusz formula', () => {
  const { heatIndexC } = require('../src/services/telemetryService');
  assert.equal(heatIndexC(30, 70), 35);
  assert.equal(heatIndexC(40, 50), 54.8);
  assert.equal(heatIndexC(null, 50), null);
});
