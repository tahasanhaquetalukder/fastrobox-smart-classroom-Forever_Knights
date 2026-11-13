-- 002_device_auth.sql — per-device token lifecycle and device health columns.
-- Idempotent: safe to run on an existing database.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS token_issued_at  TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS token_rotated_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_at       TIMESTAMPTZ;

-- Health snapshot persisted from the most recent telemetry.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status            TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fire_latched      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_reset_reason TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware          TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS uptime_s          BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rssi              INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS heap_kb           REAL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS chip_temp_c       REAL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_token_hash
  ON devices (token_hash)
  WHERE token_hash IS NOT NULL;
