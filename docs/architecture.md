# Architecture — Smart Classroom (Levels 1–4)

## Overview

```
        ┌──────────────────────────────┐        HTTPS (CA-validated)      ┌───────────────────────────┐
        │   ESP32-S3-CAM node          │  ──────────────────────────────▶ │  Node.js + Express API    │
        │                              │   telemetry / events / boot      │                           │
        │  FreeRTOS tasks (2 cores)    │  ◀────────────────────────────── │  PostgreSQL (Render/local)│
        │  DHT11 · flame · RC522       │   commands / settings / acks     │  users · roles · history  │
        │  panic pad · LED · buzzer    │                                  │                           │
        │  local page :80 / mDNS       │                                  │  SSE ───────────────┐     │
        │  NVS config + LittleFS spool │                                  │                     ▼     │
        └──────────────────────────────┘                                  │  Web dashboard (static)   │
                                                                          └───────────────────────────┘
```

Three surfaces are judged: **Serial Monitor**, the device **local status page**,
and the **web dashboard** — plus the RGB LED/buzzer and the **database records**.

## Firmware (`/firmware`, PlatformIO + Arduino)

| Module | Responsibility |
|--------|----------------|
| `main.cpp` | Task creation/pinning, watchdog, Serial commands, startup sequence |
| `heartbeat.h` | Heartbeat counters shared with the watchdog |
| `sensors.*` | DHT11 (5 s), flame (100 ms), RC522 (200 ms), fault detection, one event per tap |
| `state.*` | Status hysteresis, quality, heat index, heat trend, fire latch, panic timing |
| `alerts.*` | LED/buzzer priority state machine (strict priority) |
| `door.*` | Simulated door; refuses to lock while fire is latched |
| `touch.*` | Capacitive panic baseline calibration + 2 s hold detection |
| `config.*` | NVS settings, setup password, persistent telemetry sequence, fire-state persistence |
| `net.*` | HTTPS, NTP, telemetry/events/commands, spool, backoff, mDNS |
| `provisioning.*` | WPA2 setup AP, captive DNS, Wi-Fi scan, save/wipe |
| `statuspage.*` | Local JSON API + LittleFS assets (`data/www`) |
| `sysinfo.*`, `version.h`, `trustca.h` | Reset reason, chip data, identity, public root CA |

### Task model

| Task | Core | Period | Watchdog limit |
|------|------|--------|----------------|
| sensor | 1 | 100 ms (DHT every 5 s) | 9 s |
| rfid | 0 | 200 ms | 9 s |
| net | 0 | event-driven + 5 s telemetry | 20 s (TLS can be slow) |
| web | 0 | 2 s loop, serves clients | 9 s |
| alert | 1 | 20 ms | 9 s |
| serial | 1 | 10 ms | 8.5 s (`hang` guarantees <10 s restart) |
| touch | 1 | 50 ms | 9 s |
| watch | 1 | 1 s | — |

### Safety state machine

- Ambient status: `SAFE → WARNING → DANGER` with hysteresis
  (`DANGER` exits at 38 °C, `WARNING` exits at ≤30 °C and ≤80 % RH).
- 3 s stabilization for ambient changes; FIRE is immediate after 2 s of
  continuous flame.
- Invalid temperature/RH marks `quality=bad` and keeps the last valid status.
- Heat index (Rothfusz) and a 10-sample `RISING/STABLE/FALLING` trend are
  telemetry-only.
- FIRE latch persists in NVS, keeps the door unlocked and survives reboot.
- Panic is a local 10 s alert; the cloud is notified with `PANIC {active:true}`
  and later `{active:false}`.

### Alert priority (higher overrides lower)

`FIRE > PANIC > SENSOR_ERROR > CAMERA_FAULT > WEATHER_DANGER > HEAT_DANGER >
WARNING > ACCESS_GRANTED > DENIED > WIFI_OFFLINE > SAFE`

FIRE is red 5 Hz + continuous buzzer (solid red/no sound when silenced); PANIC
is red/blue + 100 ms buzzer for 10 s; ACCESS_GRANTED is solid green 5 s + one
short beep; DENIED is 3 red flashes + two short beeps; SENSOR_ERROR magenta,
CAMERA_FAULT cyan, WEATHER_DANGER purple with three beeps, Wi-Fi setup/offline
blue, SAFE/WARNING 2 Hz.

## Backend (`/backend`, Express + `pg`)

- `src/server.js` — security headers, `/health`, rate limit, route wiring, static.
- `src/routes/*` — auth, admin, dashboard, fire, device, legacy operator APIs.
- `src/services/*` — `authService`, `telemetryService`, `eventService`,
  `dashboardService`, `notificationService`, `commandService`, `settingsService`,
  `deviceService`, `eventBus`.
- `src/middleware/*` — `requireAuth`, `requireRole`, room scoping, device auth,
  rate limiting, error handling.
- `src/db/*` — transactional migration runner, six migrations, seeders.

### Data flow

- **Telemetry** → `POST /api/device/telemetry` → validate/normalise → unique
  `(device_id, seq)` insert → device health upsert → room state upsert (with
  fire/panic precedence) → SSE `reading` → optional FIRE/DANGER notification.
- **Events** → `POST /api/device/events` (single or `{events:[...]}`) → per-event
  dedupe/validation → `events` row → event-specific handling
  (FIRE, FIRE_CLEARED, PANIC, CARD_TAP/attendance, DOOR_CHANGE, SENSOR_ERROR) →
  SSE `event`.
- **Commands** → dashboard/API → `commands` row → device poll → ack.
- **Settings** → admin UI → `settings` → SSE; device pulls settings and applies
  acked changes.

## REST API (primary)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/health` | public | service + DB health |
| POST | `/api/auth/login` | public (rate-limited) | session token |
| POST | `/api/auth/logout` | session | revoke session |
| GET | `/api/auth/me` | session | identity + rooms |
| GET | `/api/dashboard` | session | role-scoped summary |
| GET | `/api/dashboard/events` | session | scoped event history |
| POST | `/api/fire/reset` | admin/teacher (room-scoped) | authorized fire reset |
| POST | `/api/fire/silence` | admin/teacher (room-scoped) | silence after flame gone |
| GET | `/api/fire/state` | admin/teacher | room safety state |
| GET/POST/PATCH/DELETE | `/api/admin/*` | admin | rooms, devices, cards, users, schedules, login history |
| POST | `/api/device/telemetry` | device token | periodic readings |
| POST | `/api/device/events` | device token | events (single/batch) |
| GET | `/api/device/commands` | device token | pending commands |
| POST | `/api/device/commands/:id/ack` | device token | ack |
| GET | `/api/settings` | session / legacy | settings |
| PUT | `/api/settings` | admin | validated live edit |
| GET | `/api/readings`, `/api/events`, `/api/attendance`, `/api/door` | session (legacy tokens allowed) | history / state |
| POST | `/api/door` | admin/teacher | lock/unlock command |
| GET | `/api/stream` | session header | SSE live feed |

### SSE event types

`hello`, `reading`, `event`, `door`, `attendance`, `settings`, `device`, `state`, `command`.

## Database schema

| Migration | Contents |
|-----------|----------|
| `001_init.sql` | devices, settings, sensor_readings, events, attendance, commands, firmware_versions |
| `002_device_auth.sql` | token lifecycle + device health columns + unique token hash |
| `003_identity.sql` | rooms, users, room_assignments, guardian_links, cards, attendance identity, sessions, login_history |
| `004_telemetry.sql` | Level 3/4 reading columns, `UNIQUE (device_id, seq)`, history indexes, events envelope, room_state |
| `005_ops.sql` | operations/audit support tables and indexes |
| `006_schedules.sql` | class schedules |

All migrations are additive and idempotent. The runner is transactional per
file and records applied names in `schema_migrations`.

## Security model

- bcrypt password hashes with configurable rounds; per-account lockout
  (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MS`) checked **before** password comparison.
- Random session tokens, stored as SHA-256 hashes, with TTL and logout deletion.
- Server-side RBAC + room scoping on every protected route.
- Device tokens are random and stored hashed; issue/rotate/revoke; revoked
  devices rejected even with a valid old hash.
- Login history and notification attempts are audited.
- Rate limiting per IP; uniform auth failure messages; redacted logs.
- HTTPS on device uses `setCACert()` (built-in public GTS Root R4 or NVS PEM).
  `setInsecure()` is never used.
- Security headers include CSP, frame denial, nosniff and a restrictive
  permissions policy.

## Notifications

`notificationService.js` supports `telegram`, `email` (Resend), generic
`webhook`, and `log` (record only). FIRE, PANIC and HEAT_DANGER are attempted
for the room's assigned teacher. Every attempt is written to `notification_log`
with `sent`, `skipped` or `failed`. When a provider is not fully configured the
service explicitly records `skipped` and never reports delivery.

## Offline resilience

- Events spool in a bounded RAM queue and LittleFS (`/spool.jsonl`), surviving
  network and power loss; flushed in order on reconnect.
- Telemetry sequence is reserved in NVS ahead of use, so it is strictly
  increasing across reboots; the backend rejects duplicates with 409.
- Wi-Fi reconnect backoff 2 s → 60 s; unrecoverable authentication failure
  returns to the setup portal.

## Extension points (Levels 5–12, out of scope here)

`backend/src/features/` remains the place for camera/vision/OTA routers; camera
pins stay reserved. Nothing in Levels 5–12 is implemented.

## Scaling note

`eventBus` is in-process (single instance). A multi-instance deployment would
swap it for Redis pub/sub while keeping the `publish()` interface.
