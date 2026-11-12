#!/usr/bin/env node
// Device simulator for the FastRobox Smart Classroom backend.
// Behaves like the ESP32-S3-CAM node: telemetry, RFID scans (student/teacher),
// flame + over-temperature alerts, command polling with ack, and an offline
// spool with ordered resend. Prints measured latency per event.
//
// Zero npm dependencies — Node 18+ built-ins only (fetch, crypto, fs, readline).
//
// Config comes from environment variables ONLY (no secrets or RFID UIDs are
// hard-coded). See README.md in this folder for the full list.
//
//   SIM_BACKEND_URL=http://localhost:3000 SIM_DEVICE_TOKEN=<token> node index.js
//
// Interactive keys (when run in a TTY):
//   o = go offline (spool)   r = reconnect + flush   s = student scan
//   t = teacher scan         f = flame alert         h = over-temp alert
//   ? = help                 q = quit
//
// Flags: --offline  --once  --seconds=N  --url=...  --room=...  --help

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('crypto');

const SPOOL_PATH = path.join(__dirname, 'spool.jsonl');
const bootWall = Date.now();

// --- config -----------------------------------------------------------------
function str(v, def) { return v == null || v === '' ? def : String(v); }
function num(v, def) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; }

const args = process.argv.slice(2);
function flag(name) { return args.includes('--' + name); }
function opt(name) {
  const p = args.find((a) => a.startsWith('--' + name + '='));
  return p ? p.slice(name.length + 3) : undefined;
}

if (flag('help')) {
  console.log([
    'FastRobox device simulator (zero dependencies).',
    '',
    'Required env: SIM_BACKEND_URL, SIM_DEVICE_TOKEN',
    'Optional env: SIM_DEVICE_ID, SIM_ROOM_ID, SIM_STUDENT_UID, SIM_TEACHER_UID,',
    '              SIM_TELEMETRY_MS, SIM_POLL_MS, SIM_TEMP_THRESHOLD_C,',
    '              SIM_SPOOL_MAX, SIM_HTTP_TIMEOUT_MS',
    'Flags: --offline --once --seconds=N --url=... --room=... --help',
    'Keys:  o=offline r=reconnect s=student t=teacher f=flame h=over-temp q=quit',
  ].join('\n'));
  process.exit(0);
}

const config = {
  backendUrl: str(opt('url') || process.env.SIM_BACKEND_URL, '').replace(/\/+$/, ''),
  deviceToken: process.env.SIM_DEVICE_TOKEN || '',
  deviceId: str(process.env.SIM_DEVICE_ID, 'sim-01'),
  roomId: str(opt('room') || process.env.SIM_ROOM_ID || process.env.DEFAULT_ROOM_ID, 'ROOM-1'),
  studentUid: str(process.env.SIM_STUDENT_UID, randomUUID().slice(0, 8).toUpperCase()),
  teacherUid: str(process.env.SIM_TEACHER_UID, randomUUID().slice(0, 8).toUpperCase()),
  telemetryMs: num(process.env.SIM_TELEMETRY_MS, 5000),
  pollMs: num(process.env.SIM_POLL_MS, 3000),
  tempThresholdC: num(process.env.SIM_TEMP_THRESHOLD_C, 50),
  spoolMax: num(process.env.SIM_SPOOL_MAX, 200),
  httpTimeoutMs: num(process.env.SIM_HTTP_TIMEOUT_MS, 8000),
};

const state = {
  online: !flag('offline'),
  flushing: false,
  doorState: 'LOCKED',
  flame: false,
  temperature: 26,
  humidity: 55,
  spool: [],
  sent: 0,
  dropped: 0,
};

function nowMs() { return Date.now() - bootWall; } // ms since boot, like millis()
function log(msg) { console.log(`${new Date().toISOString()} ${msg}`); }

// --- spool persistence ------------------------------------------------------
function persistSpool() {
  try {
    if (state.spool.length === 0) {
      if (fs.existsSync(SPOOL_PATH)) fs.unlinkSync(SPOOL_PATH);
      return;
    }
    const lines = state.spool.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(SPOOL_PATH, lines);
  } catch (e) {
    log(`[spool] persist error: ${e.message}`);
  }
}

function loadSpool() {
  try {
    if (!fs.existsSync(SPOOL_PATH)) return;
    const text = fs.readFileSync(SPOOL_PATH, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { state.spool.push(JSON.parse(t)); } catch { /* skip bad line */ }
    }
    if (state.spool.length) log(`[spool] loaded ${state.spool.length} buffered event(s) from disk`);
  } catch (e) {
    log(`[spool] load error: ${e.message}`);
  }
}

function spoolPush(entry, reason) {
  state.spool.push(entry);
  while (state.spool.length > config.spoolMax) {
    state.spool.shift();
    state.dropped++;
    log(`[spool] OVERFLOW policy=drop-oldest (max ${config.spoolMax}); dropped=${state.dropped}`);
  }
  persistSpool();
  log(`[spool] buffered ${entry.ev.type} (${reason}); queued=${state.spool.length}`);
}

// --- HTTP (never logs the token) --------------------------------------------
async function http(method, apiPath, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.httpTimeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(config.backendUrl + apiPath, {
      method,
      headers: {
        'X-Device-Token': config.deviceToken,
        'X-Device-Id': config.deviceId,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const latency = performance.now() - t0;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json, latency };
  } finally {
    clearTimeout(timer);
  }
}

function errSummary(r) {
  if (r.json && r.json.error) return `error=${r.json.error}`;
  return `status=${r.status}`;
}

// --- telemetry (best-effort, NOT spooled — mirrors firmware) -----------------
async function sendTelemetry() {
  if (!state.online) return;
  const body = {
    deviceId: config.deviceId,
    roomId: config.roomId,
    temperature: Number(state.temperature.toFixed(1)),
    humidity: Number(state.humidity.toFixed(1)),
    flame: state.flame,
    doorState: state.doorState,
    rssi: -50 - Math.floor(Math.random() * 20),
    uptimeMs: nowMs(),
  };
  try {
    const r = await http('POST', '/api/device/telemetry', body);
    if (r.ok) {
      state.sent++;
      log(`[telemetry] stored round-trip=${r.latency.toFixed(0)}ms temp=${body.temperature}C hum=${body.humidity}% flame=${body.flame} door=${body.doorState}`);
    } else {
      log(`[telemetry] REJECTED ${errSummary(r)}`);
    }
  } catch (e) {
    log(`[telemetry] network error: ${e.message} (best-effort, not spooled)`);
  }
}

// --- events (spooled on offline / network failure) ---------------------------
function buildEvent(type, payload) {
  return {
    type,
    roomId: config.roomId,
    deviceTs: nowMs(),
    payload: { ...payload, eventId: randomUUID() },
  };
}

async function sendEvent(type, payload) {
  const entry = { ev: buildEvent(type, payload), createdWall: Date.now() };
  if (!state.online) { spoolPush(entry, 'offline'); return; }
  try {
    const r = await http('POST', '/api/device/events', entry.ev);
    if (r.ok) {
      state.sent++;
      const lat = Date.now() - entry.createdWall;
      log(`[event ${type}] stored saved=${r.json && r.json.saved != null ? r.json.saved : '?'} end-to-end=${lat}ms (round-trip)`);
    } else {
      // Server was reached but rejected it (auth/validation) — do NOT retry-loop.
      log(`[event ${type}] REJECTED ${errSummary(r)} — not spooled`);
    }
  } catch (e) {
    spoolPush(entry, `network error: ${e.message}`);
  }
}

async function flushSpool() {
  if (!state.online || state.flushing || state.spool.length === 0) return;
  state.flushing = true;
  const batch = state.spool.map((e) => e.ev); // preserve original order
  try {
    const r = await http('POST', '/api/device/events', { events: batch });
    if (r.ok) {
      const now = Date.now();
      for (const e of state.spool) {
        const id = (e.ev.payload.eventId || '').slice(0, 8);
        log(`[flush] ${e.ev.type} id=${id} stored end-to-end=${now - e.createdWall}ms (queued+send)`);
      }
      state.sent += state.spool.length;
      log(`[flush] resent ${state.spool.length} buffered event(s) in order, round-trip=${r.latency.toFixed(0)}ms`);
      state.spool = [];
      persistSpool();
    } else {
      log(`[flush] REJECTED ${errSummary(r)} — keeping ${state.spool.length} queued`);
    }
  } catch (e) {
    log(`[flush] network error: ${e.message} — ${state.spool.length} still queued`);
  } finally {
    state.flushing = false;
  }
}

// --- commands ----------------------------------------------------------------
function setDoor(next) {
  if (state.doorState === next) return;
  state.doorState = next;
  log(`[door] -> ${next}`);
  sendEvent('door_change', { state: next });
}

async function handleCommand(c) {
  log(`[command] #${c.id} ${c.type} payload=${JSON.stringify(c.payload || {})}`);
  let status = 'acked';
  if (c.type === 'lock') setDoor('LOCKED');
  else if (c.type === 'unlock') setDoor('UNLOCKED');
  else if (c.type === 'reboot') log('[command] reboot (simulated no-op)');
  else if (c.type === 'set_config') log('[command] set_config accepted (no runtime change in simulator)');
  else { status = 'failed'; log(`[command] unknown type: ${c.type}`); }
  try {
    await http('POST', `/api/device/commands/${c.id}/ack`, { status });
    log(`[command] #${c.id} acked (${status})`);
  } catch (e) {
    log(`[command] #${c.id} ack failed: ${e.message}`);
  }
}

async function pollCommands() {
  if (!state.online) return;
  try {
    const r = await http('GET', '/api/device/commands');
    if (!r.ok) { log(`[commands] ${errSummary(r)}`); return; }
    const list = (r.json && r.json.commands) || [];
    for (const c of list) await handleCommand(c);
  } catch (e) {
    log(`[commands] network error: ${e.message}`);
  }
}

// --- alert triggers ----------------------------------------------------------
function triggerFlame() {
  state.flame = true;
  log('[alert] FLAME detected');
  sendEvent('flame_alert', { value: 1, note: 'simulated flame' });
  setTimeout(() => {
    state.flame = false;
    sendEvent('flame_clear', { value: 0 });
  }, 5000);
}

function triggerOverTemp() {
  const spike = config.tempThresholdC + 5 + Math.random() * 5;
  state.temperature = spike;
  log(`[alert] OVER-TEMP ${spike.toFixed(1)}C (threshold ${config.tempThresholdC}C)`);
  sendEvent('temp_alert', { temperature: Number(spike.toFixed(1)), threshold: config.tempThresholdC });
  setTimeout(() => { state.temperature = 26; }, 5000);
}

function driftSensors() {
  if (!state.flame && state.temperature < config.tempThresholdC) {
    state.temperature += (Math.random() - 0.5) * 0.4;
  }
  state.humidity = Math.max(20, Math.min(90, state.humidity + (Math.random() - 0.5)));
}

// --- lifecycle ---------------------------------------------------------------
const timers = [];
function every(ms, fn) { timers.push(setInterval(fn, ms)); }

function shutdown() {
  for (const t of timers) clearInterval(t);
  persistSpool();
  log(`[exit] sent=${state.sent} queued=${state.spool.length} dropped=${state.dropped}`);
  process.exit(0);
}

function printHelp() {
  log('keys: o=offline r=reconnect s=student t=teacher f=flame h=over-temp q=quit');
}

async function main() {
  if (!config.backendUrl) { console.error('ERROR: SIM_BACKEND_URL is required (e.g. http://localhost:3000).'); process.exit(1); }
  if (!config.deviceToken) { console.error('ERROR: SIM_DEVICE_TOKEN is required (from `npm run seed:device` or DEVICE_TOKEN).'); process.exit(1); }

  loadSpool();
  log(`[start] backend=${config.backendUrl} device=${config.deviceId} room=${config.roomId} token=${config.deviceToken ? 'set' : 'MISSING'}`);
  log(`[start] studentUID=${config.studentUid} teacherUID=${config.teacherUid} telemetry=${config.telemetryMs}ms poll=${config.pollMs}ms spoolMax=${config.spoolMax}`);
  log(`[start] mode=${state.online ? 'ONLINE' : 'OFFLINE'}${flag('once') ? ' --once' : ''}`);

  if (flag('once')) {
    await sendTelemetry();
    await sendEvent('rfid_scan', { uid: config.studentUid, role: 'student', accepted: true });
    await sendEvent('rfid_scan', { uid: config.teacherUid, role: 'teacher', accepted: true });
    await sendEvent('flame_alert', { value: 1, note: 'simulated flame' });
    await flushSpool();
    log(`[once] done sent=${state.sent} queued=${state.spool.length} dropped=${state.dropped}`);
    process.exit(0);
  }

  every(config.telemetryMs, sendTelemetry);
  every(config.pollMs, pollCommands);
  every(4000, flushSpool);
  every(1000, driftSensors);

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') return shutdown();
      switch (key.name) {
        case 'o': state.online = false; log('[mode] OFFLINE — events will spool'); break;
        case 'r': state.online = true; log('[mode] ONLINE — flushing'); flushSpool(); break;
        case 's': sendEvent('rfid_scan', { uid: config.studentUid, role: 'student', accepted: true }); break;
        case 't': sendEvent('rfid_scan', { uid: config.teacherUid, role: 'teacher', accepted: true }); break;
        case 'f': triggerFlame(); break;
        case 'h': triggerOverTemp(); break;
        case '?': printHelp(); break;
        case 'q': shutdown(); break;
        default: break;
      }
    });
    printHelp();
  }

  const secs = Number(opt('seconds') || 0);
  if (secs > 0) setTimeout(shutdown, secs * 1000);
}

process.on('SIGINT', shutdown);
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });