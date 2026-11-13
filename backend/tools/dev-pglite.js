'use strict';

// Local demo server without PostgreSQL: runs the real migrations and the real
// Express app against PGlite (PostgreSQL compiled to WASM).
//
//   node tools/dev-pglite.js
//
// Accounts are created with random passwords printed once to this console;
// override with DEV_* environment variables. This tool is for local demos and
// UI smoke tests only — production uses Render PostgreSQL via DATABASE_URL.

const crypto = require('crypto');
const { PGlite } = require('@electric-sql/pglite');
const config = require('../src/config');
const db = require('../src/db');
const settings = require('../src/services/settingsService');
const auth = require('../src/services/authService');
const devices = require('../src/services/deviceService');
const { runMigrations } = require('../src/db/migrate');

function password(name) {
  return process.env[name] || crypto.randomBytes(9).toString('base64url');
}

function demoPassword(name) {
  return process.env[name] || crypto.randomBytes(8).toString('base64url');
}

async function ensureUser({ email, displayName, role, pass, classLabel }) {
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return existing.rows[0];
  return auth.createUser({ email, displayName, role, password: pass, classLabel });
}

async function main() {
  config.bcryptRounds = 4; // local demo only; production default is 10
  config.adminToken = '';
  config.readToken = '';
  config.deviceToken = '';

  const pg = new PGlite();
  db.query = async (text, params) => {
    if (params === undefined && text.includes(';')) {
      await pg.exec(text);
      return { rows: [] };
    }
    return pg.query(text, params);
  };

  await runMigrations(db.query);
  await settings.ensureDefaults();
  await settings.ensureRoomSeeds();

  const room = config.defaultRoomId;
  const adminPass = password('DEV_ADMIN_PASSWORD');
  const teacherPass = demoPassword('DEV_TEACHER_PASSWORD');
  const student1Pass = demoPassword('DEV_STUDENT1_PASSWORD');
  const student2Pass = demoPassword('DEV_STUDENT2_PASSWORD');
  const guardianPass = demoPassword('DEV_GUARDIAN_PASSWORD');

  const admin = await ensureUser({
    email: process.env.DEV_ADMIN_EMAIL || 'admin@local.test',
    displayName: 'Demo Admin',
    role: 'admin',
    pass: adminPass,
  });
  const teacher = await ensureUser({
    email: 'teacher@local.test',
    displayName: 'Demo Teacher',
    role: 'teacher',
    pass: teacherPass,
    classLabel: 'Class 8A',
  });
  const student1 = await ensureUser({
    email: 'student1@local.test',
    displayName: 'Student One',
    role: 'student',
    pass: student1Pass,
    classLabel: 'Class 8A',
  });
  const student2 = await ensureUser({
    email: 'student2@local.test',
    displayName: 'Student Two',
    role: 'student',
    pass: student2Pass,
    classLabel: 'Class 8A',
  });
  const guardian = await ensureUser({
    email: 'guardian@local.test',
    displayName: 'Demo Guardian',
    role: 'guardian',
    pass: guardianPass,
  });

  for (const [userId, role] of [[teacher.id, 'teacher'], [student1.id, 'student'], [student2.id, 'student']]) {
    await db.query(
      `INSERT INTO room_assignments (room_id, user_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [room, userId, role]
    );
  }
  await db.query(
    'INSERT INTO guardian_links (guardian_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [guardian.id, student1.id]
  );

  await db.query(
    `INSERT INTO cards (uid, user_id, role, active, label) VALUES
       ('A1B2C3D4', $1, 'student', true, 'Student One card'),
       ('E5F6A7B8', $2, 'student', true, 'Student Two card'),
       ('C0FFEE01', $3, 'teacher', true, 'Teacher card')
     ON CONFLICT (uid) DO UPDATE SET user_id = EXCLUDED.user_id, role = EXCLUDED.role`,
    [student1.id, student2.id, teacher.id]
  );

  let newToken = null;
  const existing = await db.query('SELECT device_id FROM devices WHERE device_id = $1', ['demo-01']);
  if (!existing.rows.length) {
    const created = await devices.createDevice({ deviceId: 'demo-01', roomId: room, name: 'Demo classroom' });
    newToken = created.token;
  }

  const port = config.port;
  const app = require('../src/server');
  app.listen(port, () => {
    console.log('');
    console.log('Smart Classroom local demo (PGlite, not production)');
    console.log(`  URL       : http://127.0.0.1:${port}/`);
    console.log(`  Room      : ${room}`);
    console.log('  Accounts (random unless DEV_* env vars were set):');
    console.log(`    admin    ${admin.email} / ${adminPass}`);
    console.log(`    teacher  ${teacher.email} / ${teacherPass}`);
    console.log(`    student1 ${student1.email} / ${student1Pass}`);
    console.log(`    student2 ${student2.email} / ${student2Pass}`);
    console.log(`    guardian ${guardian.email} / ${guardianPass}`);
    if (newToken) {
      console.log(`  Device token (shown once): ${newToken}`);
    } else {
      console.log('  Device demo-01 already exists; rotate its token from the admin UI.');
    }
    console.log('  Stop with Ctrl+C. Data lives in memory and resets on restart.');
    console.log('');
  });
}

main().catch((err) => {
  console.error('[dev-pglite] failed:', config.redact(err.message));
  process.exitCode = 1;
});
