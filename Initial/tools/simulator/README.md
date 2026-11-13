# Device simulator

A zero-dependency Node.js script that behaves like the ESP32-S3-CAM classroom
node. It talks to the **same backend API** the firmware uses, so you can demo
and test the whole platform — telemetry, RFID attendance, flame/temperature
alerts, remote commands, and offline spool-and-resend — **without hardware**.

> This is a software tool, so it is not marked "untested on device". It is
> verified against the real backend, not against the physical ESP32.

## Dependencies

**None added.** Uses only Node 18+ built-ins: global `fetch`, `crypto`,
`fs`, `readline`, `performance.now`. No `npm install` needed in this folder.

## What it does

- **Telemetry** → `POST /api/device/telemetry` on an interval (temperature,
  humidity, flame, door state, RSSI, uptime). Best-effort, **not** spooled
  (mirrors the firmware).
- **RFID scans** → `POST /api/device/events` with `type=rfid_scan` and
  `payload.{uid,role,accepted}`. The backend auto-creates an attendance row for
  accepted scans.
- **Flame + over-temp alerts** → `flame_alert` / `temp_alert` events.
- **Command polling** → `GET /api/device/commands`, handles `lock`, `unlock`,
  `reboot`, `set_config`, then `POST /api/device/commands/:id/ack`.
- **Offline spool** → when offline or the network fails, events are buffered to
  memory **and** `spool.jsonl`, then **resent in order** as a single
  `{events:[...]}` batch on reconnect. Bounded (drop-oldest) with a printed
  overflow warning. Each event carries a unique `payload.eventId`
  (`crypto.randomUUID`) so server-side idempotency (Task 2) can dedupe it.

## Configuration (environment variables only)

No secrets and no RFID UIDs are hard-coded. The token is never printed.

| Var | Required | Default | Meaning |
|-----|----------|---------|---------|
| `SIM_BACKEND_URL` | yes | — | Backend base URL, e.g. `http://localhost:3000` or your Render URL |
| `SIM_DEVICE_TOKEN` | yes | — | Device token from `npm run seed:device`, or the bootstrap `DEVICE_TOKEN` |
| `SIM_DEVICE_ID` | no | `sim-01` | Device id sent in `X-Device-Id` |
| `SIM_ROOM_ID` | no | `ROOM-1` | Room id (falls back to `DEFAULT_ROOM_ID`) |
| `SIM_STUDENT_UID` | no | random/run | UID reported for student scans |
| `SIM_TEACHER_UID` | no | random/run | UID reported for teacher scans |
| `SIM_TELEMETRY_MS` | no | `5000` | Telemetry interval |
| `SIM_POLL_MS` | no | `3000` | Command-poll interval |
| `SIM_TEMP_THRESHOLD_C` | no | `50` | Threshold used by the over-temp trigger |
| `SIM_SPOOL_MAX` | no | `200` | Max buffered events before drop-oldest |
| `SIM_HTTP_TIMEOUT_MS` | no | `8000` | Per-request timeout |

## Run

Get a device token (printed once by the seed script — keep it out of git):

```bash
cd backend
npm run seed:device -- --device-id sim-01 --room ROOM-1
```

Then, from this folder:

```bash
# bash / Git Bash
SIM_BACKEND_URL=http://localhost:3000 SIM_DEVICE_TOKEN=<token> node index.js

# PowerShell
# $env:SIM_BACKEND_URL="http://localhost:3000"; $env:SIM_DEVICE_TOKEN="<token>"; node index.js
```

Point `SIM_BACKEND_URL` at your deployed Render URL to test the live service.

### Interactive keys (TTY)

| Key | Action |
|-----|--------|
| `o` | Go **offline** — events spool to disk |
| `r` | **Reconnect** — flush the spool in order |
| `s` / `t` | Student / teacher RFID scan |
| `f` | Flame alert (auto-clears after 5 s) |
| `h` | Over-temperature alert |
| `?` | Help · `q` | Quit |

### Flags

- `--offline` — start offline (events spool immediately).
- `--once` — send one telemetry + student + teacher + flame event, flush, exit.
  Useful for scripted checks.
- `--seconds=N` — auto-quit after N seconds.
- `--url=...`, `--room=...` — override the matching env vars.
- `--help` — usage.

## Offline spool-and-resend test (scripted, no TTY)

The spool persists to `spool.jsonl`, so resend works **across processes**:

```bash
# 1) Offline: events are buffered, nothing is sent
SIM_BACKEND_URL=http://localhost:3000 SIM_DEVICE_TOKEN=<token> node index.js --offline --once

# 2) Online: the previous spool is loaded and resent in order, then new events
SIM_BACKEND_URL=http://localhost:3000 SIM_DEVICE_TOKEN=<token> node index.js --once
```

Watch for `[spool] buffered ...` in step 1 and `[flush] ... stored end-to-end=...ms
(queued+send)` in step 2. `spool.jsonl` is deleted once the flush succeeds.
(`spool.jsonl` is gitignored — it is runtime data, never committed.)

## Latency: what the numbers mean

- **Online events / telemetry** — `end-to-end` / `round-trip` is the HTTP
  round-trip time measured with `performance.now()` (request → response).
- **Resent (offline) events** — `end-to-end` is measured from the moment the
  event was **created** until the backend **confirmed** the batch, so it
  includes the time spent queued offline.

> True *device-timestamp → backend-stored* latency (clock-synced, using NTP) is
> a Task 2 feature. This tool measures wall-clock round-trip / queue+send time
> and labels it as such — it does not claim clock-synced device latency.
