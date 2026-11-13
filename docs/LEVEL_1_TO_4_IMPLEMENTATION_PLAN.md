# Level 1–4 Implementation Plan

Date: 2026-11-13
Ordering: dependency-first (DB → backend → firmware → integration → frontend → auth → alerts → tests/docs/deploy).

Status at the time of writing is shown per step. The main root is the only
deployment target; `Initial/` is reference only.

## Phase 0 — Safety rails (already in place)

| Step | Work | Status |
|------|------|--------|
| 0.1 | Inspect `git status`, hooks (`tools/git-hooks/*`, `tools/git-compliance-check`, `tools/rules-guard.js`) before committing | Done (read-only; nothing bypassed) |
| 0.2 | Preserve existing uncommitted work; no reset/clean/checkout of unrelated files | Done |
| 0.3 | Keep `Initial/` untouched | Done |

## Phase 1 — Database (dependency root)

| Step | Work | Migration | Status |
|------|------|-----------|--------|
| 1.1 | Device health columns + token lifecycle + unique token hash | `002_device_auth.sql` (extended) | Done |
| 1.2 | Users, roles, rooms, assignments, guardian links, cards, attendance, sessions, login history | `003_identity.sql` | Done |
| 1.3 | `sensor_readings` Level-3/4 columns, `UNIQUE (device_id, seq)`, history indexes, `events` envelope/indexes, `room_state` | `004_telemetry.sql` | Done |
| 1.4 | Login/audit support tables and operational indexes | `005_ops.sql` | Done |
| 1.5 | Class schedules (admin-managed, used for Late/Absent context) | `006_schedules.sql` | Done |
| 1.6 | Transactional, idempotent migration runner + settings/room seeding | `src/db/migrate.js` | Done |
| 1.7 | Idempotent judge-account seeding from env (random passwords printed once) | `src/db/seed-users.js` | Done |

All migrations are additive (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`, `CREATE INDEX IF NOT EXISTS`) and never drop or rewrite existing data.

## Phase 2 — Backend services and APIs

| Step | Work | Status |
|------|------|--------|
| 2.1 | Telemetry validation, quality passthrough, replay rejection, room/device state upsert, fire/danger notifications | Done (`telemetryService.js`) |
| 2.2 | Event ingestion with canonical types, legacy aliases, dedupe, attendance, unknown card, server events | Done (`eventService.js`) |
| 2.3 | Fire/panic state transitions, latch, silence, authorized reset with flame guard | Done (`eventService.js`, `routes/fire.js`) |
| 2.4 | Command queue for device (`lock/unlock/fire_reset/silence_fire/set_config/reboot`) with ack | Done (`commandService.js`) |
| 2.5 | Session auth: bcrypt, lockout, login history, logout | Done (`authService.js`, `routes/auth.js`) |
| 2.6 | RBAC middleware + per-room scoping for teachers/students/guardians | Done (`userAuth.js`) |
| 2.7 | Admin APIs: rooms, devices, cards, users, schedules, login history, event log | Done (`routes/admin.js`) |
| 2.8 | Dashboard APIs: role-aware summary, event history | Done (`routes/dashboard.js`) |
| 2.9 | Notification provider abstraction (Telegram / Resend email / generic webhook / log-only) with explicit "not configured" | Done (`notificationService.js`) |
| 2.10 | Rate limiting on auth/device/write paths (merged from `Initial/`) | Done |
| 2.11 | Security hardening: parameterised SQL, input limits, redacted errors, no secret echo | Done |

## Phase 3 — Firmware (Levels 1–3)

| Step | Work | Files | Status |
|------|------|-------|--------|
| 3.1 | FreeRTOS pinned tasks + watchdog + Serial commands | `main.cpp`, `heartbeat.h` | Done |
| 3.2 | Safety state machine (hysteresis, quality, trend, FIRE latch, panic) | `state.*` | Done |
| 3.3 | LED/buzzer priority table | `alerts.*` | Done |
| 3.4 | Door logic with fire lock override | `door.*` | Done |
| 3.5 | Sensors: DHT 5 s, flame 100 ms, RFID 200 ms, fault detection, one-event-per-tap | `sensors.*` | Done |
| 3.6 | Capacitive panic with baseline calibration and 2 s hold | `touch.*` | Done |
| 3.7 | NVS config, setup password, persistent sequence reserve, fire state persistence | `config.*` | Done |
| 3.8 | Networking: HTTPS + CA, NTP, telemetry/events/commands/ack/settings, spool, backoff, mDNS | `net.*` | Done |
| 3.9 | Local status page + LittleFS assets (2 s refresh, Dhaka time, FIRE banner) | `statuspage.*`, `data/www/*` | Done |
| 3.10 | Captive provisioning portal with scan and WPA2 setup AP | `provisioning.*` | Done |
| 3.11 | Compile with PlatformIO and fix API mismatches | `firmware/` | Done (`pio run` + `buildfs` SUCCESS) |
| 3.12 | Physical verification of pins/sensors/LED/buzzer/door | hardware | Pending |

## Phase 4 — Device integration

| Step | Work | Status |
|------|------|--------|
| 4.1 | Align firmware payloads to backend contract (field names, status enum, event envelope) | Done |
| 4.2 | PANIC semantics: firmware sends `active`; backend applies it instead of blind toggle | Done |
| 4.3 | Telemetry replay rejected with 409 and not retried forever | Done |
| 4.4 | Offline spool flush on reconnect, immediate CARD_TAP/PANIC/FIRE | Done |
| 4.5 | Simulator compatibility (legacy event aliases retained) | Done |
| 4.6 | End-to-end simulator run against the backend | Done (simulator `--once`: telemetry + 3 events stored, 15–90 ms round-trip) |

## Phase 5 — Frontend

| Step | Work | Status |
|------|------|--------|
| 5.1 | Login + session handling (memory/sessionStorage only) | Done |
| 5.2 | Role-aware views (admin/teacher/student/guardian) | Done |
| 5.3 | Live SSE updates ≤3 s, reconnect, disconnected state | Done |
| 5.4 | Safety banners, authorized Reset Fire/Silence buttons | Done |
| 5.5 | Device health panel, attendance, event log, settings | Done |
| 5.6 | EN/BN switching for all user-visible strings | Done |
| 5.7 | Responsive layout, loading/empty/error states, no fake values | Done |
| 5.8 | Manual browser verification of golden path | Pending (test phase) |

## Phase 6 — Auth and alerts hardening

| Step | Work | Status |
|------|------|--------|
| 6.1 | Fail-closed authorisation on every protected route | Done |
| 6.2 | Lockout check before password comparison; no existence disclosure | Done |
| 6.3 | Login history endpoints and audit trail | Done |
| 6.4 | Notification provider configured per env; never report success when unconfigured | Done |
| 6.5 | Notification delivery verification | Blocked on credentials (documented) |

## Phase 7 — Tests, docs, deployment

| Step | Work | Status |
|------|------|--------|
| 7.1 | PGlite integration suite (migrations, auth, RBAC, lockout, telemetry, replay, events, fire, settings, guardian, device tokens, heat index) | Done |
| 7.2 | Add PANIC `active:true/false` test and Render-startup smoke test | Done (`level4.test.js`, `render.test.js`) |
| 7.3 | Run `npm test` and record real results | Done (21 tests, 21 pass, 0 fail) |
| 7.4 | Firmware compile result | Done (`pio run` SUCCESS, RAM 15.9 %, flash 42.5 %; `buildfs` SUCCESS) |
| 7.5 | Update `README.md`, `docs/architecture.md`, `docs/dependencies.md`, `docs/pin-map.md`, `docs/runbook.md`, `docs/auth.md` | Done |
| 7.6 | Update `.env.example` and `render.yaml` for new env vars (non-secret placeholders) | Done |
| 7.7 | Rewrite `docs/LEVEL_1_TO_4_COMPLETION_REPORT.md` with actual evidence | Done |
| 7.8 | Render deployment readiness review; no deployment claim without verification | Done (config reviewed; live URL checked on previous revision; new work not deployed) |

## Explicit non-goals

No Level 5–12 features (face recognition/verification, AI attendance,
anti-spoofing, occupancy vision, hand-raising, CSI, BLE offline attendance) are
implemented or planned in this pass.
