-- 001_init.sql — Phase 1 schema for AI-Powered Smart Classroom.
-- Idempotent: safe to run repeatedly. Default settings are seeded in JS
-- (settingsService.ensureDefaults) so they can read env like DEFAULT_ROOM_ID.

-- Registered devices. token_hash = sha256 hex of the per-device token.
-- Nullable for devices that authenticate via the env bootstrap token.
CREATE TABLE IF NOT EXISTS devices (
  id          SERIAL PRIMARY KEY,
  device_id   TEXT UNIQUE NOT NULL,
  name        TEXT,
  room_id     TEXT,
  token_hash  TEXT,
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Runtime-configurable key/value settings (room_id, thresholds, limits).
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Periodic telemetry from devices.
CREATE TABLE IF NOT EXISTS sensor_readings (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT NOT NULL,
  room_id     TEXT,
  temperature REAL,
  humidity    REAL,
  flame       BOOLEAN,
  door_state  TEXT,
  rssi        INTEGER,
  uptime_ms   BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_readings_device_time ON sensor_readings (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_room_time   ON sensor_readings (room_id, created_at DESC);

-- Discrete events: rfid_scan, flame_alert, door_change, boot, command_ack, ...
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT NOT NULL,
  room_id     TEXT,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  device_ts   BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_device_time ON events (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_time   ON events (type, created_at DESC);

-- Attendance derived from accepted RFID scans.
CREATE TABLE IF NOT EXISTS attendance (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT NOT NULL,
  room_id     TEXT,
  uid         TEXT NOT NULL,
  role        TEXT NOT NULL,            -- student | teacher
  event_id    BIGINT REFERENCES events(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_room_time ON attendance (room_id, created_at DESC);

-- Pending remote commands for devices (lock/unlock/set_config/reboot/...).
CREATE TABLE IF NOT EXISTS commands (
  id           BIGSERIAL PRIMARY KEY,
  device_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | acked | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  acked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_commands_device_status ON commands (device_id, status, created_at);

-- OTA extension point (later phase): firmware release history.
CREATE TABLE IF NOT EXISTS firmware_versions (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL,
  notes       TEXT,
  url         TEXT,
  checksum    TEXT,
  active      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);