# Level 1–4 Completion Report

Date: 2026-11-13
Repository: `D:\Hackathon Tahasan\fastrobox-smart-classroom-Forever_Knights`
Scope: contest Levels 1–4 only. Levels 5–12 are explicitly out of scope.

This report records what was actually implemented, executed and observed. It
does not claim hardware tests, notification delivery, or a new deployment that
were not performed in this environment.

---

## 1. Original condition summary

The main root started as a Phase-1 foundation: telemetry/events/commands over
HTTPS, PostgreSQL schema, SSE dashboard, NVS provisioning, a local status page,
an offline spool and a device simulator. It had **no** user accounts/RBAC, no
fire/panic lifecycle, no assignment or attendance model, no per-device hashed
tokens, and no Level-3 safety state machine. The previous commit (`basic`) was
the entire tracked baseline; all Level 1–4 work is uncommitted working-tree
change, and was kept that way.

`Initial/` contained a more complete Phase-1 access-control slice (fail-closed
admin auth, read token, per-device tokens, rate limiting, auth docs/tests) but
was **behind** the root on Levels 2–4 and was not used as a second application.

## 2. Main root vs `Initial/` findings

Full detail: `docs/INITIAL_VS_ROOT_AUDIT.md`.

| Area | Root (before) | `Initial/` | Decision |
|------|---------------|------------|----------|
| Admin auth | optional token when set | fail-closed when configured | Adopted fail-closed semantics in the new session/RBAC layer |
| Read auth | open | `READ_TOKEN` supported | Merged as opt-in `readAuth` |
| Device auth | shared env token | per-device hashed tokens | Root already had hashed tokens; extended with rotation/revocation |
| Rate limiting | none | login + write limiters | Merged and extended |
| Levels 2–4 | absent | absent | Implemented in root only |
| Firmware | Phase-1 modules | same baseline | Extended in root only |

Deliberate divergences (documented in the audit): automatic WPA2 setup AP
instead of BOOT-hold open AP; built-in public CA anchor instead of
`setInsecure()`; session auth as the primary path with legacy tokens retained
for operator compatibility.

## 3. Files changed / added / merged

### Database / backend

Added:

- `backend/src/db/migrations/002_device_auth.sql`
- `backend/src/db/migrations/003_identity.sql`
- `backend/src/db/migrations/004_telemetry.sql`
- `backend/src/db/migrations/005_ops.sql`
- `backend/src/db/migrations/006_schedules.sql`
- `backend/src/db/seed-users.js`
- `backend/src/middleware/rateLimit.js`, `readAuth.js`, `userAuth.js`
- `backend/src/routes/auth.js`, `admin.js`, `dashboard.js`, `devices.js`, `fire.js`
- `backend/src/services/authService.js`, `dashboardService.js`, `deviceService.js`,
  `eventService.js`, `notificationService.js`, `telemetryService.js`
- `backend/test/helpers.js`, `backend/test/level4.test.js`, `backend/test/render.test.js`
- `backend/tools/dev-pglite.js`

Modified: `config.js`, `db.js`, `db/migrate.js`, `db/seed-device.js`,
`middleware/adminAuth.js`, `deviceAuth.js`, `errorHandler.js`,
`routes/attendance.js`, `device.js`, `door.js`, `events.js`, `readings.js`,
`settings.js`, `stream.js`, `services/commandService.js`, `settingsService.js`,
`server.js`, `package.json`, `package-lock.json`.

### Firmware

Added: `alerts.*`, `state.*`, `sysinfo.*`, `touch.*`, `trustca.h`, `version.h`,
`heartbeat.h`, `firmware/data/www/*` (LittleFS assets).

Modified: `config.*`, `door.*`, `main.cpp`, `net.*`, `pins.h`, `provisioning.cpp`,
`sensors.*`, `statuspage.*`, `platformio.ini` (unchanged board/flags).

### Frontend

Modified only the existing dashboard: `backend/public/index.html`, `app.js`,
`styles.css`. No second frontend was created.

### Docs / config

Added: `docs/INITIAL_VS_ROOT_AUDIT.md`, `docs/LEVEL_1_TO_4_GAP_ANALYSIS.md`,
`docs/LEVEL_1_TO_4_IMPLEMENTATION_PLAN.md`, `docs/auth.md`, this report.

Updated: `README.md`, `docs/architecture.md`, `docs/dependencies.md`,
`docs/pin-map.md`, `docs/runbook.md`, `.env.example`, `render.yaml`.

## 4. Level-by-level status

| Level | Status | Evidence |
|-------|--------|----------|
| 1 — Firmware foundation | Implemented, compiled; physical tests pending | Seven pinned FreeRTOS tasks, watchdogs, serial commands, fault recovery, LED/buzzer priority table, startup flame check |
| 2 — Provisioning & cloud link | Implemented, compiled; physical tests pending | WPA2 setup AP + 8-char password, scan/save/wipe, NVS, reconnect backoff, 15 s AP fallback, persistent seq, HTTPS + CA, NTP, 5 s telemetry, immediate CARD_TAP, backend outage detection, LittleFS status page |
| 3 — Safety logic | Implemented and backend-verified; physical fire/panic tests pending | SAFE/WARNING/DANGER/FIRE hysteresis, 3 s stabilization, quality gate, heat index/trend, fire latch, teacher silence, panic touch, canonical events |
| 4 — Auth, RBAC, alerts, dashboard | Implemented and verified in tests + browser | bcrypt, lockout, sessions, Admin/Teacher/Student/Guardian scope, admin APIs, role-aware dashboard, EN/BN, notifications abstraction |

Detailed requirement table: `docs/LEVEL_1_TO_4_GAP_ANALYSIS.md`.

## 5. Database changes

Additive only; no table or column is dropped or rewritten.

- `002_device_auth.sql` — device token hash uniqueness/rotation metadata,
  `device_id`/last-seen health fields.
- `003_identity.sql` — `users`, `sessions`, `login_history`, `rooms`,
  `room_assignments`, `guardian_links`, `cards`, `attendance`.
- `004_telemetry.sql` — Level-3/4 reading columns (`seq`, `ts`, `uptime_s`,
  `temp_c`, `rh`, `heat_index_c`, `heat_trend`, `status`, `quality`, `heap_kb`,
  `chip_temp_c`, `fw`), `UNIQUE (device_id, seq)`, history indexes, event
  envelope columns and indexes, `room_state` (fire latch, panic, silence).
- `005_ops.sql` — notification log/audit support and operational indexes.
- `006_schedules.sql` — `class_schedules` for Late/Absent context.

## 6. Firmware changes

- **Scheduling:** sensor task 5 s DHT / 100 ms flame loop, RFID 200 ms,
  UI/alerts, serial, touch, and network/web tasks pinned to cores; per-task
  watchdog plus task watchdog; reset-reason logging.
- **State machine:** SAFE/WARNING/DANGER/FIRE with 3 s stabilization, exit
  thresholds (38 °C / 30 °C / 80 % RH), quality `bad` for out-of-range readings
  while retaining the last valid status, Rothfusz heat index, 10-sample trend.
- **Fire:** 2 s continuous flame → immediate FIRE, continuous buzzer, 5 Hz red,
  door unlock, latch persisted in NVS; `FIRE_CLEARED` does not clear the latch;
  teacher-card silence only after flame is gone; door stays unlocked until reset.
- **Panic:** capacitive touch with baseline calibration, ≥ 2 s hold triggers,
  < 1 s ignored, explicit `active` flag in the event.
- **Alerts:** full priority table (SAFE/WARNING/HEAT DANGER/FIRE/PANIC/ACCESS
  GRANTED/DENIED/SENSOR ERROR/CAMERA FAULT/WEATHER DANGER/Wi-Fi setup) with
  higher priority pre-emption.
- **Access:** one event per card tap, unknown-card and denied events, teacher
  role from programmed UID, 5 s granted indication, three-flash denial.
- **Config:** NVS values, generated 8-character setup password, sequence
  reserve-ahead across reboots, fire-state persistence.
- **Cloud:** HTTPS with a CA anchor (GTS Root R4 built in, optional NVS PEM),
  NTP UTC, strictly increasing seq, 409 on replay, backoff, spool flush,
  settings pull, mDNS.
- **Local page:** LittleFS assets with embedded fallback, `/api/state` every 2 s,
  Dhaka time, FIRE banner.

## 7. Backend / API changes

New endpoint groups (all mounted in `server.js`):

- `POST /api/auth/login|logout`, `GET /api/auth/me`
- `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id`,
  `GET /api/admin/login-history`, rooms/assignments, cards, schedules,
  notifications
- `GET /api/dashboard/summary`, `GET /api/dashboard/events`
- `GET /api/fire/state`, `POST /api/fire/reset`, `POST /api/fire/silence`
- `GET/POST /api/devices`, `POST /api/devices/:id/token|revoke` (admin)
- Existing device API extended with canonical event types, replay rejection,
  attendance, room/device state and command ack.

Validation and safety: parameterised SQL everywhere, bounded input sizes,
canonical telemetry field checks, replay rejected with 409, batch events keep
per-event sequence rejection without dropping the rest, redacted error output,
security headers, rate limits on auth/device/write paths.

## 8. Frontend changes

Existing dashboard preserved and extended: login/session handling, role-aware
views (admin full control; teacher assigned rooms + Reset Fire; student own
attendance; guardian linked children), SSE live updates and disconnected state,
FIRE/PANIC banners driven by room state (including the latch), device-health
panel, attendance, event log, admin user/room/card/schedule editors, settings,
and full EN/BN switching with accessible labels. No simulated values are
displayed as if they were measurements; empty/loading/error states are present.

## 9. Tests — commands and actual results

```bash
cd backend
npm test
```

Actual result on 2026-11-13:

```
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ duration_ms ~2341
```

Coverage (17 required checks mapped):

| # | Required test | Result |
|---|---------------|--------|
| 1 | DB connection | Pass (`/health` with PGlite) |
| 2 | Migrations | Pass (`migrations create the Level 1-4 schema...`) |
| 3 | Device auth | Pass (`device tokens are hashed, rotatable and revocable`) |
| 4 | Admin auth | Pass (`admin login, session identity and role-based access control`) |
| 5 | Lockout | Pass (`login locks an account ... after five failures`) |
| 6 | RBAC | Pass (same test + teacher/guardian scope tests) |
| 7 | Unauthorized API | Pass (`protected endpoints reject unauthenticated requests`) |
| 8 | Telemetry validation | Pass (`device telemetry is validated ...`) |
| 9 | Duplicate seq | Pass (replay rejected; batch event duplicate test) |
| 10 | Event ingestion | Pass (`card taps create attendance ...`) |
| 11 | FIRE processing | Pass (`FIRE latches the room ...`) |
| 12 | PANIC processing | Pass (`PANIC honours the explicit active flag ...`) |
| 13 | Settings validation | Pass (`settings writes are validated ...`) |
| 14 | Dashboard APIs | Pass (`device health is exposed ...`, `health endpoint ...`) |
| 15 | Frontend/API integration | Pass (manual browser run; static-asset test) |
| 16 | Render startup compatibility | Pass (`server module loads ...`, render.yaml invariants) |
| 17 | Firmware compile | See §10 |

Additional passing tests: unknown-account response parity, heat index formula,
guardian scoping, device health, event-sequence isolation.

### Simulator end-to-end (no hardware)

```bash
# local PGlite backend
cd backend && PORT=3100 node tools/dev-pglite.js
# another shell
cd tools/simulator
SIM_BACKEND_URL=http://127.0.0.1:3100 SIM_DEVICE_TOKEN=<token> node index.js --once
```

Observed: telemetry stored (90 ms), three events stored (15–17 ms), 0 queued,
0 dropped. Records were read back through `/api/readings` and `/api/events`
with a teacher session. This is simulated, not physical.

### Browser verification (manual, not automated CI)

Admin login, dashboard data, SSE FIRE banner, flame-clear state, authorized
Reset Fire, EN/BN switch, student-only attendance view, and CARD_TAP attendance
were exercised in the running app. Screenshot capture was unavailable in the
automation viewport; structural page snapshots were used instead.

## 10. Firmware compile result

Commands and actual result on 2026-11-13:

```bash
cd firmware
pio run                 # SUCCESS in 51.72 s
pio run -t buildfs      # SUCCESS in 8.80 s
```

Observed output:

```
RAM:   15.9% (used 52180 bytes from 327680 bytes)
Flash: 42.5% (used 1420695 bytes from 3342336 bytes)
Successfully created ESP32-S3 image.
========================= [SUCCESS] =========================
```

Artifacts: `firmware/.pio/build/esp32-s3-cam/firmware.bin` (1,464,912 bytes)
and `spiffs.bin` (www assets). Resolved toolchain: `espressif32` 8.0.0,
Arduino framework 4.30312.261024 (ESP32-S3 libs 3.3.12), xtensa-esp-elf
14.2.0. No warnings or errors originated from project sources; the only
repeated warning is a harmless `CORE_DEBUG_LEVEL` macro redefinition from the
build flags.

Environment note: C: had only ~1.3 GB free, so PlatformIO's core was relocated
with `PLATFORMIO_CORE_DIR=D:/pio-core`. Judge machines with normal disk space
need no such change.

Flash/upload commands (not executed — no board attached):

```bash
pio run -t uploadfs     # LittleFS assets
pio run -t upload       # flash
pio device monitor      # 115200
```

## 11. Deployment readiness

- `render.yaml` keeps `rootDir: backend`, `npm run migrate && npm start`,
  `healthCheckPath: /health`, managed PostgreSQL, and generates secrets.
- The Express app loads with `NODE_ENV=production` and no `DATABASE_URL`
  without crashing (verified test), so `/health` can report DB state.
- Static dashboard assets are present and served from `backend/public`.
- `.env.example` documents every variable with blank/placeholder secrets.
- **Live URL check:** `https://fastrobox-smart-classroom.onrender.com/health`
  returned `HTTP 200 {"status":"ok","db":"up"}` on 2026-11-13. This is the
  **previously deployed revision**; the Level 1–4 working tree has **not** been
  pushed or deployed. No deployment success is claimed for this work.

Remaining production steps require the repository owner: commit, run
`node tools/git-compliance-check`, push to `main`, watch the Render deploy, then
re-check `/health`, dashboard login and the judge accounts.

## 12. Physical hardware tests still required

1. RFID read range/one-event-per-tap with the actual white card and blue tag.
2. DHT11 reading accuracy and fault detection ≤ 12 s (disconnect data line).
3. Flame sensor active-low/active-high polarity and 100 ms response.
4. Startup flame check (no flame → locked, flame → unlocked).
5. LED colours/rates and buzzer patterns for every priority state.
6. Door auto-lock timing and remote unlock/lock round-trip.
7. Panic touch baseline calibration and 2 s hold on the chosen GPIO.
8. Watchdog restart after deliberate `hang` within 10 s.
9. Provisioning AP join, Wi-Fi scan, save, reboot persistence, and 15 s
   fallback after unrecoverable failure.
10. Power-loss test of the fire latch and sequence continuity.

None of these were executed; no hardware was connected.

## 13. Missing credentials / external dependencies

- No notification provider credentials (Telegram bot token, Resend key, or
  webhook). `NOTIFY_PROVIDER=log` logs "not delivered" explicitly; nothing is
  pretended to be sent.
- No Render/GitHub credentials were used; deployment was not performed.
- No physical ESP32-S3-CAM, sensors, RFID reader, or buzzer/LED available.
- Judge account passwords must be supplied through environment variables at
  seed time; nothing is hard-coded.

## 14. Exact next steps

1. `cd firmware && pio run` (then `uploadfs`, `upload`) — fix any compile
   errors and record the result.
2. Wire per `docs/pin-map.md`, run the 10 physical tests above, record outcomes.
3. Set judge emails/passwords and notification credentials in the Render
   environment, then run `npm run seed:users` once.
4. `node tools/git-compliance-check`; review `git status`; commit and push to
   `main` (owner action, plain push only).
5. Verify the new Render deploy: `/health`, admin/teacher/student/guardian
   logins, live SSE, FIRE/PANIC banner and Reset Fire, notification delivery.

## 15. Limitations / non-goals

No Level 5–12 feature (face recognition, AI attendance, anti-spoofing,
occupancy vision, hand-raising, CSI, BLE offline attendance) was implemented.
TLS uses a public CA anchor rather than certificate pinning per device. The
in-process SSE bus is single-instance. `Initial/` remains untouched and is not
a deployment target.
