-- 004_telemetry.sql — Level 2/3 telemetry and event fidelity.
-- Adds the judged telemetry fields, replay protection and event sequence.

ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS seq           BIGINT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS ts            BIGINT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS uptime_s      BIGINT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS temp_c        REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS rh            REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS heat_index_c  REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS heat_trend    TEXT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS status        TEXT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS quality       TEXT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS heap_kb       REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS chip_temp_c   REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS fw            TEXT;

-- Replay protection: one row per (device_id, seq).
CREATE UNIQUE INDEX IF NOT EXISTS uq_readings_device_seq
  ON sensor_readings (device_id, seq)
  WHERE seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_readings_quality ON sensor_readings (quality, created_at DESC);

ALTER TABLE events ADD COLUMN IF NOT EXISTS seq              BIGINT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ts               BIGINT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS detail           TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS server_generated BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_device_seq
  ON events (device_id, seq)
  WHERE seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_room_time ON events (room_id, created_at DESC);

ALTER TABLE commands ADD COLUMN IF NOT EXISTS issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
