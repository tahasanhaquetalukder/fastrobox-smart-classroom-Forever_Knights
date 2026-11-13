-- 005_ops.sql — fire/panic room state, notification audit, indexes.

CREATE TABLE IF NOT EXISTS room_state (
  room_id        TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'SAFE',
  fire_latched   BOOLEAN NOT NULL DEFAULT false,
  fire_silenced  BOOLEAN NOT NULL DEFAULT false,
  panic_active   BOOLEAN NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_log (
  id         BIGSERIAL PRIMARY KEY,
  room_id    TEXT,
  event_type TEXT NOT NULL,
  recipient  TEXT,
  provider   TEXT NOT NULL,
  status     TEXT NOT NULL,            -- sent | failed | skipped
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_time ON notification_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_room ON notification_log (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_devices_room_last_seen ON devices (room_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_device     ON events (type, device_id, created_at DESC);
