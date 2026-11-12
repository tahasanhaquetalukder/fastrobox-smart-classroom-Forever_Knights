'use strict';

const $ = (id) => document.getElementById(id);
const EVENTS_MAX = 30;
const ATT_MAX = 30;

// --- Admin token (only needed if the server sets ADMIN_TOKEN) ---
const adminInput = $('adminToken');
adminInput.value = localStorage.getItem('adminToken') || '';
adminInput.addEventListener('change', () => localStorage.setItem('adminToken', adminInput.value.trim()));

function headers(json) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  const t = adminInput.value.trim();
  if (t) h['X-Admin-Token'] = t;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleTimeString();
}

// --- UI updates ---
function setReading(r) {
  if (!r) return;
  if (r.temperature != null) $('temp').textContent = Number(r.temperature).toFixed(1);
  if (r.humidity != null) $('hum').textContent = Number(r.humidity).toFixed(0);
  if (r.flame != null) setFlame(r.flame);
  if (r.door_state) setDoor(r.door_state, r.created_at);
  if (r.room_id) $('roomId').textContent = r.room_id;
}

function setFlame(active) {
  const el = $('flame');
  el.textContent = active ? 'ALERT' : 'Clear';
  el.className = 'badge ' + (active ? 'alert' : 'ok');
  $('flameCard').classList.toggle('alarm', !!active);
}

function setDoor(state, at) {
  const el = $('door');
  const s = (state || 'UNKNOWN').toUpperCase();
  el.textContent = s;
  el.className = 'badge ' + (s === 'UNLOCKED' ? 'ok' : s === 'LOCKED' ? 'alert' : 'neutral');
  $('doorCard').classList.toggle('unlocked', s === 'UNLOCKED');
  if (at) $('doorAt').textContent = fmtTime(at);
}

function eventSummary(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'rfid_scan': return `${p.role || 'card'} ${p.uid || ''} — ${p.accepted ? 'accepted' : 'denied'}`;
    case 'flame_alert': return p.active === false ? 'flame cleared' : 'flame detected';
    case 'door_change': return `door ${p.state || ''}`;
    case 'command_ack': return `command ${p.commandId || ''} ${p.status || 'acked'}`;
    case 'boot': return 'device boot';
    default: return JSON.stringify(p).slice(0, 60);
  }
}

function addEvent(ev, prepend = true) {
  const ul = $('events');
  const li = document.createElement('li');
  li.innerHTML = `<span class="tag ${ev.type}">${ev.type}</span>
    <span class="desc"></span><span class="time">${fmtTime(ev.created_at)}</span>`;
  li.querySelector('.desc').textContent = eventSummary(ev);
  if (prepend) ul.prepend(li); else ul.append(li);
  while (ul.children.length > EVENTS_MAX) ul.removeChild(ul.lastChild);
}

function addAttendance(a, prepend = true) {
  const ul = $('attendance');
  const li = document.createElement('li');
  li.innerHTML = `<span class="tag ${a.role}">${a.role}</span>
    <span class="desc"></span><span class="time">${fmtTime(a.created_at)}</span>`;
  li.querySelector('.desc').textContent = a.uid;
  if (prepend) ul.prepend(li); else ul.append(li);
  while (ul.children.length > ATT_MAX) ul.removeChild(ul.lastChild);
}

function applySettings(s) {
  if (!s) return;
  if (s.room_id != null) $('roomId').textContent = s.room_id;
  if (s.temp_threshold_c != null) $('tempTh').textContent = s.temp_threshold_c;
  if (s.humidity_threshold_pct != null) $('humTh').textContent = s.humidity_threshold_pct;
  const form = $('settingsForm');
  for (const [k, v] of Object.entries(s)) {
    if (form.elements[k] != null) form.elements[k].value = v;
  }
}

// --- Door control ---
async function doorAction(action) {
  $('doorCmd').textContent = `sending ${action}…`;
  try {
    const body = await api('/api/door', { method: 'POST', headers: headers(true), body: JSON.stringify({ action }) });
    $('doorCmd').textContent = `${action} queued (command #${body.command.id})`;
  } catch (e) {
    $('doorCmd').textContent = `error: ${e.message}`;
  }
}
$('lockBtn').addEventListener('click', () => doorAction('lock'));
$('unlockBtn').addEventListener('click', () => doorAction('unlock'));

// --- Settings form ---
$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    payload[el.name] = el.type === 'number' ? Number(el.value) : el.value;
  }
  $('settingsMsg').textContent = 'saving…';
  try {
    const body = await api('/api/settings', { method: 'PUT', headers: headers(true), body: JSON.stringify(payload) });
    applySettings(body.settings);
    $('settingsMsg').textContent = 'saved';
  } catch (err) {
    $('settingsMsg').textContent = `error: ${err.message}`;
  }
});

// --- Initial load ---
async function initialLoad() {
  try { applySettings((await api('/api/settings')).settings); } catch (_) {}
  try { const r = (await api('/api/readings?limit=1')).readings[0]; if (r) setReading(r); } catch (_) {}
  try { const d = await api('/api/door'); setDoor(d.state, d.at); } catch (_) {}
  try { (await api('/api/events?limit=20')).events.reverse().forEach((ev) => addEvent(ev)); } catch (_) {}
  try { (await api('/api/attendance?limit=20')).attendance.reverse().forEach((a) => addAttendance(a)); } catch (_) {}
}

// --- Live updates via SSE ---
function connectSSE() {
  const es = new EventSource('/api/stream');
  const setConn = (on) => {
    $('connDot').className = 'dot ' + (on ? 'on' : 'off');
    $('connText').textContent = on ? 'live' : 'reconnecting…';
  };
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.addEventListener('reading', (e) => setReading(JSON.parse(e.data).data));
  es.addEventListener('door', (e) => { const d = JSON.parse(e.data).data; setDoor(d.state, d.at); });
  es.addEventListener('event', (e) => {
    const ev = JSON.parse(e.data).data;
    addEvent(ev);
    if (ev.type === 'flame_alert') setFlame((ev.payload || {}).active !== false);
    if (ev.type === 'door_change' && ev.payload) setDoor(ev.payload.state, ev.created_at);
  });
  es.addEventListener('attendance', (e) => addAttendance(JSON.parse(e.data).data));
  es.addEventListener('settings', (e) => applySettings(JSON.parse(e.data).data));
  es.addEventListener('command', (e) => {
    const c = JSON.parse(e.data).data;
    $('doorCmd').textContent = `command #${c.id} ${c.type} (${c.status})`;
  });
}

initialLoad().then(connectSSE);