# Level 1–4 Gap Analysis

Date: 2026-11-13
Project: FastRobox Smart Classroom — team Forever_Knights
Legend: **DONE** = implemented and covered by code/tests (or compile-checked for firmware);
**PARTIAL** = implemented but a specified sub-part is unverified or needs a non-hardware test;
**MISSING** = not implemented; **PHYSICAL** = requires the real ESP32-S3 kit and cannot be
claimed from this environment.

The single canonical project is the repository root. `Initial/` is reference only.

---

## Level 1 — Firmware foundation

| # | Requirement | Status | Evidence / gap |
|---|-------------|--------|----------------|
| 1.1 | FreeRTOS, tasks split across both cores | DONE | `firmware/src/main.cpp` creates seven pinned tasks (sensor/alert/touch/serial/watch on core 1, rfid/net/web on core 0) |
| 1.2 | DHT11 sampled every 5 s | DONE | `main.cpp` sensor task gate `now - lastDhtAt >= 5000` |
| 1.3 | Flame sampled every 100 ms | DONE | sensor task is `vTaskDelayUntil(100 ms)` and calls `sensorsReadFlame()` |
| 1.4 | RFID polled every 200 ms | DONE | rfid task `vTaskDelay(200 ms)` |
| 1.5 | Exactly one event per card tap | DONE | `sensorsPollCard()` halts the PICC and applies a 1500 ms same-UID cooldown |
| 1.6 | Watchdog restarts a hung device in <10 s | DONE | `watchTask` checks per-task heartbeat ages; serial-task limit 8.5 s guarantees `hang` restart <10 s |
| 1.7 | Reset reason logged/reported | DONE | `sysinfo.cpp` + `[STATUS]` boot line + telemetry `reset_reason` + `/api/state` |
| 1.8 | Serial 115200 | DONE | `Serial.begin(115200)` |
| 1.9 | Commands `help,status,health,tasks,ver,hang,reset` | DONE | `serialTask` command parser (plus `seq`, `settings`, `wifi-reset`) |
| 1.10 | Log tags `[STATUS][CARD][EVENT][ERROR][NET][OTA][CAM][BLE][CMD]` | DONE | Tags used across modules; `[OTA][CAM][BLE]` are reserved for later levels and printed only where relevant |
| 1.11 | DHT fault visible ≤12 s | DONE | `DHT_FAULT_MS = 12000`, magenta SENSOR ERROR and `SENSOR_ERROR` event |
| 1.12 | RFID fault visible ≤3 s | DONE | version-register probe every 500 ms; re-init every 3 s; `SENSOR_ERROR` |
| 1.13 | Recovery without freeze | PARTIAL | Recovery paths implemented; needs a **physical** fault-injection test (unplug DHT / RFID) |
| 1.14 | Startup flame check | DONE | `stateBootFlameCheck()` unlocks the door and latches FIRE when flame is present at boot |
| 1.15 | LED/buzzer priority table | DONE | `alerts.cpp` implements every listed pattern and strict priority |
| 1.16 | Don't invent pins | DONE | all pins remain placeholders in `pins.h`; touch pin documented as unverified |
| 1.17 | Physical LED/buzzer/sensor behaviour | PHYSICAL | Not claimed — no hardware in this environment |

## Level 2 — Provisioning, local page, cloud link

| # | Requirement | Status | Evidence / gap |
|---|-------------|--------|----------------|
| 2.1 | Setup AP `SmartClass-<TeamID>` | DONE | `configApSsid()` → `SmartClass-Forever_Knights` |
| 2.2 | 8-char setup password printed on Serial | DONE | `configEnsureSetupPassword()` (unambiguous alphabet), printed while AP runs only |
| 2.3 | Setup page at 192.168.4.1 | DONE | `provisioning.cpp` captive DNS + HTTP server |
| 2.4 | Wi-Fi scan + signal strength | DONE | `/scan` returns SSID/RSSI/security |
| 2.5 | Accept Wi-Fi password, Room ID, device token | DONE | `/save` form + NVS writes |
| 2.6 | NVS storage | DONE | `Preferences` namespace `sc_cfg` |
| 2.7 | Reconnect after loss with growing retry intervals | DONE | 2 s → 60 s backoff in `net.cpp` |
| 2.8 | Return to setup ≤15 s after unrecoverable failure | PARTIAL | logic uses `WL_CONNECT_FAILED` / auth-failure timeout >15 s; needs **physical** router-off test |
| 2.9 | Restore after power interruption | DONE | all settings in NVS; boot restores network without re-provisioning |
| 2.10 | Boot/reset method clears Wi-Fi | DONE | BOOT held 5 s at runtime wipes Wi-Fi and reboots into setup |
| 2.11 | Sequence numbers survive restarts | DONE | `seq_high` reserve-ahead in NVS |
| 2.12 | Local page: IP, mDNS, LittleFS, ≤2 s refresh | DONE | `statuspage.cpp` + `firmware/data/www/*`, 2000 ms poll, mDNS `smartclass-foreverknights.local` |
| 2.13 | Local page fields (room, Dhaka time, temp, RH, status, flame, door, last card, RSSI, chip temp, fw, connection) | DONE | `/api/state` + assets |
| 2.14 | HTTPS with certificate validation | PARTIAL | `setCACert()` always; built-in public GTS Root R4 + NVS override; **no insecure fallback**. TLS handshake against the live host needs a physical/network test |
| 2.15 | Device-token auth | DONE | `X-Device-Token` / `X-Device-Id` headers |
| 2.16 | NTP and UTC timestamps | DONE | `configTime(0,0,...)`; events/telemetry send Unix seconds |
| 2.17 | Persistent strictly increasing seq | DONE | NVS counter + reserve |
| 2.18 | Reject replayed telemetry | DONE | backend `UNIQUE (device_id, seq)` + 409 handling |
| 2.19 | Telemetry every 5 ± 1 s | DONE | `cfg.telemetryIntervalMs` default 5000 |
| 2.20 | CARD_TAP immediately | DONE | queued on tap and flushed by net task immediately |
| 2.21 | BOOT event after startup | DONE | sent once Wi-Fi connects (ts omitted if NTP not ready) |
| 2.22 | Backend outage detection ≤30 s, resume after recovery | PARTIAL | 30 s offline threshold + spool implemented; simulator offline→reconnect ordered resend verified (3 events, 36 ms); firmware timer still needs a physical router test |
| 2.23 | Required telemetry fields + DB uniqueness | DONE | fields match `telemetryService.js`; unique index in `004_telemetry.sql` |
| 2.24 | Physical provisioning/AP test | PHYSICAL | Not claimed |

## Level 3 — Safety state machine

| # | Requirement | Status | Evidence / gap |
|---|-------------|--------|----------------|
| 3.1 | SAFE/WARNING/DANGER/FIRE | DONE | `state.cpp` |
| 3.2 | WARNING temp ≥32 or RH ≥85 | DONE | thresholds in NVS/config |
| 3.3 | DANGER temp ≥40 | DONE | |
| 3.4 | Exit DANGER at 38 | DONE | hysteresis |
| 3.5 | Exit WARNING at ≤30 °C and ≤80 % RH | DONE | hysteresis |
| 3.6 | 3 s stabilization except FIRE | DONE | `STATUS_STABLE_MS = 3000`, FIRE immediate |
| 3.7 | Heat index | DONE | Rothfusz, unit test |
| 3.8 | Invalid temp/RH → quality=bad, retain status | DONE | range checks + last-valid retention |
| 3.9 | Heat trend over 10 readings, no effect on outputs | DONE | `TREND_RISING/STABLE/FALLING`, telemetry-only |
| 3.10 | FIRE after 2 s continuous flame | DONE | `flameResponseLimitMs` default 2000 |
| 3.11 | FIRE: buzzer, red 5 Hz, unlock door, local `FIRE – EVACUATE` | DONE | `alerts.cpp`, `door.cpp`, local page |
| 3.12 | FIRE event within 3 s | DONE | immediate queue on latch |
| 3.13 | Fire latch survives power loss | DONE | `fire_latch` NVS + boot restore |
| 3.14 | Door stays unlocked until authorized reset | DONE | `doorLock()` refuses while latched |
| 3.15 | Teacher tag silences only after flame gone | DONE | firmware silence check + backend `/api/fire/silence` guard |
| 3.16 | Student tags cannot silence | DONE | role check before silence |
| 3.17 | Panic touch via jumper, calibration, ≥2 s triggers, <1 s ignored | DONE | `touch.cpp` baseline/threshold/hold + ignore log |
| 3.18 | PANIC to cloud ≤3 s | DONE | immediate event queue |
| 3.19 | Event catalogue + envelope | DONE | `netQueueEvent`, `eventService.js` |
| 3.20 | Server-generated IDs for server events | DONE | `insertServerEvent()` (BIGSERIAL) |
| 3.21 | Physical fire/panic/touch test | PHYSICAL | Not claimed |

## Level 4 — Accounts, security, operations

| # | Requirement | Status | Evidence / gap |
|---|-------------|--------|----------------|
| 4.1 | bcrypt or Argon2 | DONE | bcryptjs, rounds configurable |
| 4.2 | RBAC admin/teacher/student/guardian | DONE | `userAuth.js`, `dashboardService.js`, role-scoped routes |
| 4.3 | Admin manages rooms/devices/users/cards/schedules/settings, all logs | DONE | `/api/admin/*`, `/api/dashboard/events` |
| 4.4 | Teacher assigned rooms, alerts, authorized Reset Fire | DONE | `/api/fire/*` with room assertion |
| 4.5 | Student sees only own attendance | DONE | `dashboardService.studentView()` |
| 4.6 | Guardian sees linked children + history + Late/Absent notices | DONE | `guardianView()`, notifications for late arrival |
| 4.7 | Authorisation on every protected route | DONE | middleware on every router; unauth test |
| 4.8 | Judge accounts with configurable credentials + docs | DONE | `seed:users` env-driven, random password printed once; documented in `docs/auth.md` and README |
| 4.9 | Lockout 30 s after 5 wrong passwords, correct password cannot bypass | DONE | `authService.login()` checks lock before password compare; test |
| 4.10 | Admin login history | DONE | `login_history` + `/api/admin/login-history` |
| 4.11 | Rate limiting | DONE | merged from `Initial/`; login/device/write buckets |
| 4.12 | No account-existence/sensitive leakage | DONE | identical failure message + dummy bcrypt work; generic errors |
| 4.13 | Live dashboard ≤3 s | DONE | SSE `reading/state/event/device` events |
| 4.14 | Required live data, FIRE/PANIC banners, reset controls, device health | DONE | dashboard UI + `/api/dashboard/summary` |
| 4.15 | Notifications ≤10 s via configured provider | PARTIAL | `notificationService.js` supports Telegram/Resend/webhook/log; **no provider credentials here**, so delivery is not claimed |
| 4.16 | EN/BN switching | DONE | dashboard i18n dictionary + toggle |
| 4.17 | Physical end-to-end alert test | PHYSICAL | Not claimed |

---

## Cross-cutting requirements

| Area | Status | Notes |
|------|--------|-------|
| Single frontend in `backend/public/` | DONE | No duplicate app created |
| Responsive + loading/empty/error states | DONE | CSS breakpoints + state rendering |
| No misleading simulated values | DONE | UI marks disconnected/unknown explicitly |
| Safe, non-destructive migrations | DONE | all `IF NOT EXISTS`, additive; unique index added without dropping data |
| Parameterised SQL | DONE | all routes use `$n` placeholders |
| Structured logs / secret redaction | DONE | error handler + `config.redact()` |
| Tests (≥17 listed) | DONE | 21/21 pass: `level4.test.js` (18) + `render.test.js` (3); PANIC-active and Render-startup covered |
| Firmware compile | DONE | `pio run` SUCCESS (RAM 15.9 %, flash 42.5 %); `pio run -t buildfs` SUCCESS; espressif32 8.0.0 / xtensa-esp-elf 14.2.0 |
| Deployment to Render | NOT VERIFIED | Live URL healthy on the previous revision; this working tree is not pushed/deployed. No Render credentials used |
| Docs set | DONE | README/architecture/deps/pin-map/runbook/auth updated; audit, gap, plan and completion report added |

## Physical tests still required

1. DHT unplug/replug (fault ≤12 s, recovery), RFID unplug/replug (fault ≤3 s).
2. Flame response: 2 s continuous flame → FIRE, buzzer, 5 Hz red, door unlock.
3. Fire latch across power loss; reset from dashboard and teacher card.
4. Teacher vs student card silence behaviour.
5. Panic pad touch <1 s ignored / ≥2 s triggers within 3 s, cloud PANIC within 3 s.
6. Provisioning AP password, scan, save, reconnect, power-cycle restore, BOOT-hold wipe.
7. Wi-Fi loss → retry backoff → setup return ≤15 s (unrecoverable case).
8. HTTPS handshake to Render URL and telemetry/command round trip.
9. Watchdog: `hang` command restarts in <10 s.
10. LED/buzzer patterns for every priority state.
