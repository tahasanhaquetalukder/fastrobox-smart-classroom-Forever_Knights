// Create the Level-4 judge accounts idempotently.
//   npm run seed:users
//
// Credentials come from environment variables. When a password variable is
// absent a random password is generated and printed ONCE. No production
// password is hard-coded in the repository.
//
//   ADMIN_EMAIL / ADMIN_PASSWORD
//   TEACHER_EMAIL / TEACHER_PASSWORD
//   STUDENT1_EMAIL / STUDENT1_PASSWORD
//   STUDENT2_EMAIL / STUDENT2_PASSWORD
//   GUARDIAN_EMAIL / GUARDIAN_PASSWORD
//   DEFAULT_ROOM_ID (default ROOM-1)
//   TEACHER_CARD_UID / STUDENT1_CARD_UID / STUDENT2_CARD_UID (optional)
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const auth = require('../services/authService');
const settings = require('../services/settingsService');

function env(name, fallback) {
  return String(process.env[name] || '').trim() || fallback;
}

function generated() {
  return crypto.randomBytes(9).toString('base64url');
}

async function upsertUser(spec) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [spec.email]);
  if (rows.length) {
    return { user: rows[0], created: false };
  }
  const user = await auth.createUser({
    email: spec.email,
    password: spec.password,
    displayName: spec.displayName,
    role: spec.role,
    classLabel: spec.classLabel,
  });
  return { user, created: true };
}

async function assign(roomId, userId, role) {
  await db.query(
    `INSERT INTO room_assignments (room_id, user_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [roomId, userId, role]
  );
}

async function bindCard(uid, userId, role, label) {
  const normalized = String(uid || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!normalized) return;
  await db.query(
    `INSERT INTO cards (uid, user_id, role, active, label) VALUES ($1,$2,$3,true,$4)
     ON CONFLICT (uid) DO UPDATE SET user_id = EXCLUDED.user_id, role = EXCLUDED.role,
       active = true, label = EXCLUDED.label`,
    [normalized, userId, role, label]
  );
}

async function run() {
  await settings.ensureDefaults();
  await settings.ensureRoomSeeds();
  const roomId = config.defaultRoomId;

  const specs = [
    {
      key: 'ADMIN', role: 'admin',
      email: env('ADMIN_EMAIL', 'admin@smartclass.local'),
      password: env('ADMIN_PASSWORD', generated()),
      displayName: env('ADMIN_NAME', 'Admin'),
    },
    {
      key: 'TEACHER', role: 'teacher',
      email: env('TEACHER_EMAIL', 'teacher@smartclass.local'),
      password: env('TEACHER_PASSWORD', generated()),
      displayName: env('TEACHER_NAME', 'Teacher'),
      classLabel: env('TEACHER_CLASS', 'Class 8-A'),
    },
    {
      key: 'STUDENT1', role: 'student',
      email: env('STUDENT1_EMAIL', 'student1@smartclass.local'),
      password: env('STUDENT1_PASSWORD', generated()),
      displayName: env('STUDENT1_NAME', 'Student S1'),
      classLabel: env('STUDENT1_CLASS', 'Class 8-A'),
    },
    {
      key: 'STUDENT2', role: 'student',
      email: env('STUDENT2_EMAIL', 'student2@smartclass.local'),
      password: env('STUDENT2_PASSWORD', generated()),
      displayName: env('STUDENT2_NAME', 'Student S2'),
      classLabel: env('STUDENT2_CLASS', 'Class 8-A'),
    },
    {
      key: 'GUARDIAN', role: 'guardian',
      email: env('GUARDIAN_EMAIL', 'guardian@smartclass.local'),
      password: env('GUARDIAN_PASSWORD', generated()),
      displayName: env('GUARDIAN_NAME', 'Guardian of S1'),
    },
  ];

  const created = [];
  const passwords = {};
  const byKey = {};
  for (const spec of specs) {
    const result = await upsertUser(spec);
    byKey[spec.key] = result.user;
    if (result.created) {
      created.push(spec.key);
      passwords[spec.key] = spec.password;
    }
  }

  await assign(roomId, byKey.TEACHER.id, 'teacher');
  await assign(roomId, byKey.STUDENT1.id, 'student');
  await assign(roomId, byKey.STUDENT2.id, 'student');
  await db.query(
    `INSERT INTO guardian_links (guardian_id, student_id) VALUES ($1,$2)
     ON CONFLICT (guardian_id, student_id) DO NOTHING`,
    [byKey.GUARDIAN.id, byKey.STUDENT1.id]
  );

  await bindCard(env('TEACHER_CARD_UID', ''), byKey.TEACHER.id, 'teacher', 'Teacher card');
  await bindCard(env('STUDENT1_CARD_UID', ''), byKey.STUDENT1.id, 'student', 'Student S1 card');
  await bindCard(env('STUDENT2_CARD_UID', ''), byKey.STUDENT2.id, 'student', 'Student S2 card');

  console.log(`[seed:users] room=${roomId} created=${created.join(',') || 'none'}`);
  console.log('[seed:users] accounts:');
  for (const spec of specs) {
    console.log(`  ${spec.role.padEnd(9)} ${spec.email}${passwords[spec.key] ? `  password=${passwords[spec.key]}` : '  (existing, password unchanged)'}`);
  }
  if (Object.keys(passwords).length) {
    console.log('[seed:users] Generated passwords are shown only once. Store them securely.');
  }
}

run()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error(`[seed:users] failed: ${config.redact(err.message)}`);
    process.exitCode = 1;
    db.pool.end();
  });
