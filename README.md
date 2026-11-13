# AI-Powered Smart Classroom: Safety, Access and Attendance

FastRobox 1.0 Techathon Grand Finale (BUBT) — team **Forever_Knights**.

An ESP32-S3-CAM classroom node (RFID access, DHT11, flame safety, buzzer, RGB
LED, capacitive panic pad, **software-simulated door**) backed by a Node.js +
PostgreSQL cloud platform with a role-aware live dashboard. Everything judges
tune at runtime — Wi-Fi, Room ID, thresholds, response limits, RFID UIDs — is
**stored in NVS or the database**, never hard-coded. Devices survive network and
power loss via an offline flash spool and durable sequence numbers.

> Scope: this repository implements **Levels 1–4 only**. Camera/face features,
> AI attendance, BLE attendance and other Level 5–12 items are intentionally out
> of scope. Extension points remain in `backend/src/features/`.

---

## Hardware

| Part | Role |
|------|------|
| ESP32-S3-CAM | MCU, onboard RGB LED, BOOT button, camera reserved for later levels |
| RC522 RFID (13.56 MHz) | White card = student, blue key-tag = teacher |
| DHT11 | Temperature / humidity |
| IR flame sensor (3-pin, DO) | Flame / fire detection |
| Active buzzer | Audible feedback / alarm |
| Jumper wire + touch-capable GPIO | Capacitive panic pad |
| Relay/solenoid *or simulated* | Door lock (software state is authoritative in the demo) |

The door is **simulated in software** (`LOCKED` / `UNLOCKED`) and reported on
the LED, Serial Monitor, the device status page and the dashboard. There is no
physical lock in the reference build.

> GPIOs in [`firmware/src/pins.h`](firmware/src/pins.h) are **placeholders**.
> Verify them against your exact board variant before wiring — see
> [`docs/pin-map.md`](docs/pin-map.md).

## Repository structure

```
firmware/   PlatformIO + Arduino project (Levels 1–3)
  src/      tasks, state machine, alerts, sensors, touch, network, provisioning
  data/www/ LittleFS local status page
backend/    Express API + SSE + PostgreSQL migrations + dashboard (public/)
tools/      Device simulator, Git compliance/contest helpers
docs/       audit, gap analysis, plan, architecture, auth, pin map, runbook
README.md  .env.example  render.yaml
```

## Architecture (short)

- **Device** runs FreeRTOS tasks pinned across both cores with a per-task
  watchdog, samples DHT11 every 5 s, flame every 100 ms and RFID every 200 ms,
  runs the safety state machine, drives LED/buzzer priority patterns, holds the
  door and fire latch, serves a local page, and talks to the backend over
  HTTPS with certificate validation.
- **Backend** validates and stores telemetry/events, enforces `(device_id, seq)`
  uniqueness, manages attendance, fire/panic state, commands, users/roles,
  settings, login audit and notifications, and pushes live updates via **SSE**.
- **Dashboard** (served by the backend) provides role-specific views for
  Admin, Teacher, Student and Guardian, with English/Bangla switching.

Details: [`docs/architecture.md`](docs/architecture.md).

---

## Prerequisites

- **Node.js ≥ 18** and npm (tested on Node 24).
- **PostgreSQL ≥ 13** for production/local server; the demo tool runs PGlite.
- **PlatformIO** (`pip install platformio`) to build/flash the firmware.

## Backend — local run with PostgreSQL

```bash
cd backend
npm install

cp ../.env.example ../.env     # edit DATABASE_URL and optional secrets

# create the database once, then:
npm run migrate
npm run seed:users             # judge accounts; prints generated passwords once
npm run seed:device -- --device-id classroom-01 --room ROOM-1

npm run dev                    # or npm start
```

- Dashboard: `http://localhost:3000`
- Health: `http://localhost:3000/health`
- SSE: `http://localhost:3000/api/stream` (authorised header required)

### Backend — local run without PostgreSQL (demo/UI smoke test)

```bash
cd backend
node tools/dev-pglite.js
```

This runs the real migrations and Express app against in-process PGlite and
prints the demo accounts. Data lives in memory and resets on restart. This tool
is **not** the deployment path.

## Judge accounts

`npm run seed:users` creates the accounts idempotently from environment
variables (`ADMIN_*`, `TEACHER_*`, `STUDENT1_*`, `STUDENT2_*`, `GUARDIAN_*`).
If a password variable is blank, a random password is generated and printed
**once**; nothing is committed. It also assigns the teacher/students to
`DEFAULT_ROOM_ID`, links the guardian to Student S1 and optionally binds card
UIDs. See [`docs/auth.md`](docs/auth.md) for the role matrix.

## Firmware — build & flash

```bash
cd firmware
pio run                    # compile
pio run -t upload          # flash (set upload_port in platformio.ini)
pio run -t uploadfs        # upload LittleFS status-page assets
pio device monitor         # 115200 baud
```

**First boot / provisioning:** when no Wi-Fi is configured (or after a BOOT
hold of 5 s) the device starts a WPA2 access point
`SmartClass-Forever_Knights`. The 8-character setup password is printed on the
Serial console. Join the AP, open `http://192.168.4.1/`, scan for networks and
save Wi-Fi, Room ID, server URL, device token, thresholds and card UIDs. Values
persist in NVS and the device restores them after power loss.

**Local status page:** `http://<device-ip>/` or
`http://smartclass-foreverknights.local/` shows Room ID, Asia/Dhaka time,
temperature, humidity, heat index, status, flame, door, last card, RSSI, chip
temperature, firmware version and connection state, refreshed every 2 s.

**Serial commands:** `help`, `status`, `health`, `tasks`, `ver`, `hang`,
`reset`, `seq`, `settings`, `wifi-reset`.

## Device simulator (no hardware needed)

A zero-dependency Node script that mimics the ESP32 node against the same
backend API: telemetry, card scans, flame/over-temp/panic events, command polling
with ack, and an offline spool with ordered resend. Config is environment-only.

```bash
cd tools/simulator
SIM_BACKEND_URL=http://localhost:3000 SIM_DEVICE_TOKEN=<token> node index.js
```

Interactive keys: `o` offline · `r` reconnect+flush · `s`/`t` student/teacher
scan · `f` flame · `h` over-temp · `q` quit. Flags: `--offline`, `--once`,
`--seconds=N`. See [`tools/simulator/README.md`](tools/simulator/README.md).

## Tests

```bash
cd backend && npm test
```

The suite runs the real migrations against PGlite and covers schema, health,
authentication, RBAC, lockout, telemetry validation/replay, event ingestion,
FIRE/PANIC transitions, settings validation, guardian scope, device token
lifecycle and heat index. Physical hardware behaviour is **not** covered and is
listed in [`docs/LEVEL_1_TO_4_COMPLETION_REPORT.md`](docs/LEVEL_1_TO_4_COMPLETION_REPORT.md).

## Deploy to Render (public HTTPS)

The preserved URL is `https://fastrobox-smart-classroom.onrender.com/`.

1. Push this repository to GitHub.
2. Render → **New +** → **Blueprint** → select the repo (`render.yaml`).
3. Render creates the web service + PostgreSQL, generates `DEVICE_TOKEN`,
   `ADMIN_TOKEN` and `READ_TOKEN`, and runs migrations on boot.
4. Run `npm run seed:users` once from the Render Shell with the desired
   `ADMIN_PASSWORD` etc. (or let it generate and print passwords).
5. Copy the public URL and a per-device token into the device provisioning page.
6. Set `NOTIFY_PROVIDER` plus provider credentials only if real delivery is
   wanted; `log` means alerts are recorded but not sent.

Deployment has **not** been executed from this environment; see the runbook for
the exact verification steps.

---

## Security model (summary)

- bcrypt password hashes; 5 failed logins lock the account for 30 s (a correct
  password does **not** bypass an active lock); uniform failure messages avoid
  account-existence disclosure.
- Server-side sessions (SHA-256 token hashes) and server-side RBAC on every
  protected route: Admin, Teacher, Student, Guardian.
- Per-device random tokens stored as hashes, with issue/rotate/revoke.
- HTTPS only on the device, `setCACert()` with a public root CA; no
  `setInsecure()` fallback.
- Parameterised SQL, input validation, rate limits, redacted logs, security
  headers.
- No secrets in git. See [`docs/auth.md`](docs/auth.md).

## Runtime-configurable values

| Where | Values |
|-------|--------|
| Device NVS (provisioning page) | Wi-Fi, Room ID, server URL, device token, thresholds, timings, card UIDs, root CA override, setup password |
| Backend `settings` table (admin UI) | Room ID, thresholds, response limits |
| Admin UI | Rooms, devices, cards, users, schedules, settings |

## Repository compliance

```bash
node tools/install-hooks.js
node tools/git-compliance-check
```

The tools scan for secrets and forbidden artefacts without printing suspected
values. Level-tag and judge steps are in [`docs/runbook.md`](docs/runbook.md);
dependencies are listed in [`docs/dependencies.md`](docs/dependencies.md).

## Level documentation

- [`docs/INITIAL_VS_ROOT_AUDIT.md`](docs/INITIAL_VS_ROOT_AUDIT.md)
- [`docs/LEVEL_1_TO_4_GAP_ANALYSIS.md`](docs/LEVEL_1_TO_4_GAP_ANALYSIS.md)
- [`docs/LEVEL_1_TO_4_IMPLEMENTATION_PLAN.md`](docs/LEVEL_1_TO_4_IMPLEMENTATION_PLAN.md)
- [`docs/LEVEL_1_TO_4_COMPLETION_REPORT.md`](docs/LEVEL_1_TO_4_COMPLETION_REPORT.md)

## Limitations

- Hardware-dependent behaviour (GPIO correctness, DHT/RFID fault timing, flame
  response, panic pad, LED/buzzer patterns, HTTPS handshake) requires physical
  verification; it is not claimed here.
- Notification delivery is untested without provider credentials.
- The Render deployment was not re-deployed in this pass.
