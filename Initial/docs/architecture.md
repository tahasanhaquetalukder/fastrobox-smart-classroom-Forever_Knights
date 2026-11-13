# Architecture — AI-Powered Smart Classroom (Phase 1)

## Overview

```
        ┌─────────────────────────────┐         HTTPS (REST)        ┌──────────────────────────┐
        │   ESP32-S3-CAM device        │  ─────────────────────────▶ │  Node.js + Express API    │
        │                              │   telemetry / events        │                          │
        │  DHT11  flame  RC522         │  ◀───────────────────────── │  PostgreSQL              │
        │  door state machine          │   commands / settings       │  readings/events/...     │
        │  RGB LED + buzzer            │                             │                          │
        │  local status page (:80)     │                             │  SSE  ──────────────┐    │
        │  NVS config + LittleFS spool │                             │                     ▼    │
        └─────────────────────────────┘                             │   Web dashboard (static) │
                                                                     └──────────────────────────┘
```

Three surfaces the judges check: **Serial Monitor**, the device **local status
page**, and the **web dashboard** — plus the **RGB LED / buzzer** and the
**database records**. All are fed from the same device state.

## Components

### Device (`/firmware`, PlatformIO + Arduino)
Modular split so later levels slot in cleanly:

| Module | Responsibility |
|--------|----------------|
| `pins.h` | All GPIO definitions (placeholders to verify per board) |
| `config.*` | NVS-backed runtime config; UID classification |
| `provisioning.*` | AP mode + captive web page (first boot / BOOT held) |
| `sensors.*` | DHT11, IR flame, RC522 (debounced UID reads) |
| `door.*` | Simulated door state machine, RGB LED, buzzer (non-blocking) |
| `net.*` | HTTPS telemetry/events, command polling, settings sync, offline spool |
| `statuspage.*` | Local status web page on port 80 |
| `main.cpp` | Orchestration + edge detection (flame, door) |

### Backend (`/backend`, Express + `pg`)
- `src/server.js` — app wiring, `/health`, static dashboard.
- `src/routes/*` — REST endpoints (see below).
- `src/services/*` — `eventBus` (SSE fan-out), `settingsService`, `commandService`.
- `src/middleware/*` — `deviceAuth`, fail-closed `adminAuth`, error handling.
- `src/db/*` — migration runner, SQL migrations, device seed script.
- `src/features/` — **extension point** for later phases (vision, OTA, levels).

### Dashboard (`/backend/public`, vanilla JS)
Same-origin static files. Initial authenticated REST fetch + header-capable
`fetch` streaming for live SSE updates. Remote lock/unlock and runtime settings.

## Data flow

- **Telemetry** (periodic): device `POST /api/device/telemetry` → `sensor_readings`
  → SSE `reading` → dashboard cards.
- **Events** (edge-triggered): device `POST /api/device/events` → `events` → SSE
  `event`. Accepted `rfid_scan` also writes `attendance`; `door_change` also
  pushes SSE `door`.
- **Commands** (remote): dashboard `POST /api/door` → `commands` row → device
  `GET /api/device/commands` (marks delivered) → device acts → `POST .../ack`.
- **Settings** (live): dashboard `PUT /api/settings` → `settings` table → SSE
  `settings`; device also `GET /api/settings` every 30s to adopt judge changes.

## Door state machine (simulated)

`LOCKED ⇄ UNLOCKED`, no physical lock. Transitions:
- Accepted RFID (student/teacher) → `UNLOCKED` + auto-lock timer.
- Remote `lock`/`unlock` command.
- Auto-lock after `door_auto_lock_ms` (runtime-configurable).

LED: red = locked, green = unlocked, blue = provisioning, yellow = connecting,
flashing red/blue = flame alert, red flash = denied. Buzzer: short beep = unlock,
long beep = denied, repeating alarm = flame. All non-blocking (`millis()`).

## Offline resilience

- Events are spooled to a bounded RAM ring (100) **and** persisted to LittleFS
  (`/spool.jsonl`), so they survive **network loss and power loss**.
- On reconnect, `netFlush()` batch-posts the spool to `/api/device/events`
  (`{events:[...]}`) and clears it on success.
- Telemetry is periodic (latest value wins); a Wi-Fi watchdog reconnects.

## Runtime configuration (never hard-coded)

| Layer | Store | Values |
|-------|-------|--------|
| Device | NVS (`Preferences`) | Wi-Fi, room id, server URL, token, thresholds, response limits, UIDs |
| Backend | `settings` table | room id, thresholds, response limits (editable live) |

Provisioning page writes NVS; backend settings sync pulls judge changes down to
the device. Defaults are seeds, not fixed constants.

## Security model

- **Device auth**: per-device token stored **hashed** (sha256) in `devices`, or
  shared bootstrap only when `DEVICE_BOOTSTRAP_ENABLED=true` and `DEVICE_TOKEN`
  are both configured. Sent as `X-Device-Token`. Never in source.
- **Admin guard**: `ADMIN_TOKEN` protects every dashboard mutation; dashboard
  sends `X-Admin-Token`. Mutations fail closed with 503 when it is unset.
- **Secrets**: only `.env.example` is committed; `.env` + firmware secrets are
  gitignored. Render generates `ADMIN_TOKEN`; device bootstrap is off by default.
- **Protected reads**: `READ_TOKEN` or `ADMIN_TOKEN` protects dashboard reads
  and SSE; devices can read settings with their device token. No tokens in URLs.
- **TLS**: the device requires an HTTPS URL and provisioned root CA and validates
  the server with `WiFiClientSecure.setCACert()`. There is no insecure fallback.
- **Rate limits**: per-IP auth-failure and write limits are runtime-configured.

## REST API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | — | health + DB status |
| POST | `/api/device/telemetry` | device | periodic readings |
| POST | `/api/device/events` | device | event (single or batch) |
| GET | `/api/device/commands` | device | poll pending commands |
| POST | `/api/device/commands/:id/ack` | device | acknowledge command |
| POST | `/api/devices` | admin | issue device + token |
| POST | `/api/devices/:id/token` | admin | rotate token |
| POST | `/api/devices/:id/revoke` | admin | revoke device |
| GET | `/api/settings` | read/admin/device | read settings |
| PUT | `/api/settings` | admin | edit settings |
| GET | `/api/readings` | read/admin | recent readings |
| GET | `/api/events` | read/admin | recent events |
| GET | `/api/attendance` | read/admin | attendance list |
| GET | `/api/door` | read/admin | current door state |
| POST | `/api/door` | admin | remote lock/unlock → command |
| GET | `/api/stream` | read/admin | SSE live feed; auth headers only |

The selected protected-read model is detailed in [`auth.md`](auth.md).

### SSE event types
`hello`, `reading`, `event`, `door`, `attendance`, `settings`, `command`.

## Database schema (Phase 1)

`devices`, `settings`, `sensor_readings`, `events`, `attendance`, `commands`,
`firmware_versions` (OTA extension point), plus `schema_migrations`. See
[`001_init.sql`](../backend/src/db/migrations/001_init.sql).

## Extension points for later phases

- **Camera snapshots / face recognition**: add a `vision` feature router under
  `backend/src/features/`, a `snapshots` table via a new migration, and a camera
  module in firmware (camera pins reserved in `pins.h`).
- **OTA firmware history**: `firmware_versions` table already exists; add an
  `ota` feature router + firmware update module.
- **Level-specific features**: register routers in `features/index.js`; keep each
  level modular. Tag completed levels `level-NN`.

## Scaling note

`eventBus` is in-process (single instance). A multi-instance deployment would
swap it for Redis pub/sub — the `publish()` interface stays the same.