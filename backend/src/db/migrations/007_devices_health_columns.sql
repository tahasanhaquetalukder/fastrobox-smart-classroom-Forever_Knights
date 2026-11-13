-- 007_devices_health_columns.sql — repair databases where 002 was applied
-- before its device-health columns were added to the file. Migrations are
-- immutable once applied, so the repair lives here instead of in 002.
-- Idempotent: safe on databases that already have the columns.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS status            TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fire_latched      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_reset_reason TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware          TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS uptime_s          BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rssi              INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS heap_kb           REAL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS chip_temp_c       REAL;
