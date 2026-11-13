-- 006_schedules.sql — admin-managed class schedules (Level 4 admin scope).

CREATE TABLE IF NOT EXISTS schedules (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  teacher_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject     TEXT,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_schedules_room ON schedules (room_id, day_of_week, start_time);
