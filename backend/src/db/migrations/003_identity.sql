-- 003_identity.sql — Level 4 users, roles, rooms, cards, sessions and login audit.
-- Idempotent. Existing data is preserved.

CREATE TABLE IF NOT EXISTS rooms (
  room_id    TEXT PRIMARY KEY,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'guardian')),
  password_hash   TEXT NOT NULL,
  class_label     TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Teacher -> room assignment (also used for students' class membership).
CREATE TABLE IF NOT EXISTS room_assignments (
  id         SERIAL PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments (user_id);

CREATE TABLE IF NOT EXISTS guardian_links (
  id         SERIAL PRIMARY KEY,
  guardian_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_guardian_links_guardian ON guardian_links (guardian_id);

-- RFID card/tag registry. UID is stored uppercase hex without separators.
CREATE TABLE IF NOT EXISTS cards (
  uid        TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role       TEXT NOT NULL DEFAULT 'student',
  active     BOOLEAN NOT NULL DEFAULT true,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT,
  success    BOOLEAN NOT NULL,
  reason     TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_history_time ON login_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history (user_id, created_at DESC);

-- Attendance gains an identity link and a once-per-day arrival constraint.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'present';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS attendance_date DATE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS event_ts        TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_day
  ON attendance (user_id, attendance_date)
  WHERE user_id IS NOT NULL AND attendance_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_user_time ON attendance (user_id, created_at DESC);
