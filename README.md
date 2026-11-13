# AI-Powered Smart Classroom: Safety, Access and Vision

FastRobox 1.0 Techathon Grand Finale (BUBT) — team **Forever_Knights**.

An ESP32-S3-CAM classroom node (RFID access, temp/humidity, flame safety, a
**software-simulated door**) backed by a Node.js + PostgreSQL cloud platform with
a live web dashboard. Everything the judges tune live — Wi-Fi, Room ID,
thresholds, response limits, RFID UIDs — is **runtime-configurable**, never
hard-coded. The device keeps working through network/power loss via offline
buffering.

> Status: **Phase 1** (foundation). Camera snapshots, face recognition and OTA
> are later phases; clean extension points are already in place.

---

## Hardware (fixed by competition rules)

| Part | Role |
|------|------|
| ESP32-S3-CAM | MCU, camera (later phase), onboard RGB LED, BOOT button |
| RC522 RFID (13.56 MHz) | 1 white card = **student**, 1 blue key-tag = **teacher** |
| DHT11 | Temperature / humidity |
| IR flame sensor (3-pin, DO) | Flame / fire alert |
| Active buzzer | Audible feedback / alarm |
| Jumper wires | Wiring |

The door is **simulated in software** (`LOCKED` / `UNLOCKED`) shown on the RGB
LED, Serial Monitor, the device's local status page and the web dashboard. There
is no physical lock. See [`docs/pin-map.md`](docs/pin-map.md) — **fill in the
free GPIOs after checking your exact board variant** (the camera occupies many
pins).

## Repository structure

```
firmware/   PlatformIO + Arduino project for ESP32-S3-CAM
backend/    Express REST API + SSE, PostgreSQL migrations, dashboard (public/)
tools/      Device simulator and Git compliance/contest tools
docs/       architecture notes, pin map, level notes
README.md  .gitignore  .env.example  render.yaml
```

## Architecture (short)

- **Device** reads sensors + RFID, runs the door state machine, serves a local
  status page, and talks to the backend over HTTPS (telemetry, events, command
  polling). Offline events are spooled to flash and flushed on reconnect.
- **Backend** stores readings/events/attendance, issues remote commands, holds
  runtime `settings`, and pushes live updates to the dashboard via **SSE**.
- **Dashboard** (served by the backend) shows live safety/access state and lets
  operators lock/unlock and edit settings.

Details: [`docs/architecture.md`](docs/architecture.md).

---

## Prerequisites

- **Node.js ≥ 18** and npm (tested on Node 24/26).
- **PostgreSQL ≥ 13** (local install, or a Render/managed instance).
- **PlatformIO** (VS Code extension or `pip install platformio`) to build/flash
  the firmware.

## Backend — run locally

```bash
cd backend
npm install

# 1) Configure env: copy the root example and edit it
cp ../.env.example ../.env        # then edit ../.env (DATABASE_URL, etc.)

# 2) Create the database (once), e.g.:
#    createdb fastrobox
#    or: psql -c "CREATE DATABASE fastrobox;"

# 3) Create tables + seed default settings
npm run migrate

# 4) Register a device token (prints the token ONCE — put it in the device)
npm run seed:device -- --device-id classroom-01 --room ROOM-1
#    ...or set DEVICE_TOKEN in .env to use a shared bootstrap token instead.

# 5) Start
npm run dev      # auto-reload (node --watch)
# or
npm start
```

- API + dashboard: `http://localhost:3000`
- Health check: `http://localhost:3000/health`
- Live stream (SSE): `http://localhost:3000/api/stream`

The backend loads `.env` from the **repo root**. On Render, env vars are set in
the service dashboard and take precedence (no file needed).

## Firmware — build & flash

```bash
cd firmware
pio run                 # build
pio run -t upload       # flash (set upload_port in platformio.ini if needed)
pio device monitor      # Serial Monitor @ 115200
```

**First boot / provisioning:** with no saved Wi-Fi, or if you **hold BOOT during
reset**, the device starts an access point `SmartClassroom-XXXX`. Join it, open
`http://192.168.4.1/`, and enter Wi-Fi SSID/password, Room ID, server URL, device
token, thresholds and the student/teacher RFID UIDs. Values are saved to **NVS**
(no credentials in source) and the device reboots onto your network.

**Local status page:** once online, open `http://<device-ip>/` for Wi-Fi status,
room id, temp/humidity, flame state, door state, last RFID event and uptime.

> Verify GPIOs in [`firmware/src/pins.h`](firmware/src/pins.h) against your board
> before wiring — see [`docs/pin-map.md`](docs/pin-map.md).

## Device simulator (no hardware needed)

A zero-dependency Node script that mimics the ESP32 node against the **same
backend API**: telemetry, student/teacher RFID scans, flame/over-temp alerts,
command polling with ack, and an **offline spool with ordered resend**. It
prints measured latency per event. Config is environment-only (no hard-coded
secrets or UIDs).

```bash
# from tools/simulator, using a token from `npm run seed:device`
SIM_BACKEND_URL=http://localhost:3000 SIM_DEVICE_TOKEN=<token> node index.js
```

Interactive keys: `o` offline · `r` reconnect+flush · `s`/`t` student/teacher
scan · `f` flame · `h` over-temp · `q` quit. Flags: `--offline`, `--once`,
`--seconds=N`. Full usage, env vars and the offline resend test:
[`tools/simulator/README.md`](tools/simulator/README.md).

## Deploy to Render (public HTTPS)

1. Push this repo to GitHub.
2. Render → **New +** → **Blueprint** → pick this repo (reads `render.yaml`).
3. Render creates the web service + PostgreSQL and **generates** `DEVICE_TOKEN`
   and `ADMIN_TOKEN`. Set `DEFAULT_ROOM_ID` when prompted.
4. After deploy, copy the public URL (e.g. `https://YOUR-APP.onrender.com`) into
   the device provisioning page as the **server URL**, and copy `DEVICE_TOKEN`
   from the Render env tab into the device.

`startCommand` runs migrations automatically on boot; `/health` is the health
check.

---

## Manual configuration checklist (you must set these)

- [ ] `DATABASE_URL` — local Postgres or Render connection string.
- [ ] Device token — from `npm run seed:device` output **or** Render-generated
      `DEVICE_TOKEN`; enter it on the device provisioning page.
- [ ] `ADMIN_TOKEN` (optional) — if set, enter it in the dashboard's admin field
      to allow lock/unlock and settings edits.
- [ ] Device provisioning — Wi-Fi, Room ID, server URL, thresholds, RFID UIDs.
- [ ] `firmware/src/pins.h` / `docs/pin-map.md` — confirm free GPIOs for your
      ESP32-S3-CAM variant.
- [ ] Render — Blueprint deploy + copy public URL/token back to the device.

## Runtime-configurable (never hard-coded)

| Where | Values |
|-------|--------|
| Device NVS (provisioning page) | Wi-Fi SSID/password, Room ID, server URL, device token, temp/humidity thresholds, flame response limit, door auto-lock delay, student/teacher UIDs |
| Backend `settings` table (`/api/settings`) | Room ID, thresholds, response limits — editable live from the dashboard |

## Security notes

- No secrets in git. Only `.env.example` is committed; `.env` and firmware
  secrets are gitignored.
- Device endpoints require a per-device token (hashed in DB) or the env
  bootstrap token. Tokens are never hard-coded.
- Mutating dashboard routes (settings/door) are optionally guarded by
  `ADMIN_TOKEN`.
- The device uses HTTPS to the backend. For the demo it accepts the server cert
  without pinning (`setInsecure()`); see `docs/architecture.md` for the tradeoff.

## Repository compliance

Install the optional local Git hooks and run the full repository check:

```bash
node tools/install-hooks.js
node tools/git-compliance-check
```

The tools scan for secrets and forbidden artifacts without printing suspected
values. Evaluation-tag commands and judge-access steps are in
[`docs/runbook.md`](docs/runbook.md); every direct library and hosted service
is listed in [`docs/dependencies.md`](docs/dependencies.md).

## Levels

No contest level tags have been created yet. During the contest, each level
gets a `docs/levels/level-NN.md` write-up and an exact `level-NN` Git tag.

### Per-level changelog

- No evaluated levels yet. From `level-02` onward, add the new entry before
  creating its tag; the tag helper enforces this reminder.

## Development roadmap

Phase 1 = foundation (this commit set). Later: camera snapshot upload, face
recognition, OTA firmware updates with history, and level-specific features.
Each completed level will be tagged `level-NN`. Extension points live in
`backend/src/features/` and the firmware module split.