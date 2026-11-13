'use strict';

const $ = (id) => document.getElementById(id);
const EVENTS_MAX = 30;
const ATT_MAX = 30;

// --- Read/admin token (memory/sessionStorage only, never persistent storage) ---
const adminInput = $('adminToken');
try {
  adminInput.value = sessionStorage.getItem('accessToken') || '';
  sessionStorage.removeItem('adminToken');
} catch (_) {}
try { localStorage.removeItem('adminToken'); } catch (_) {}
adminInput.addEventListener('input', () => {
  try { sessionStorage.setItem('accessToken', adminInput.value.trim()); } catch (_) {}
});

function headers(json) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  const t = adminInput.value.trim();
  if (t) {
    h['X-Admin-Token'] = t;
    h['X-Read-Token'] = t;
  }
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...headers(Boolean(opts.body)), ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function mutationError(err) {
  if (err.status === 401) return 'enter a valid admin token';
  if (err.status === 503) return 'server administrator must configure ADMIN_TOKEN';
  return err.message;
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
    $('doorCmd').textContent = `error: ${mutationError(e)}`;
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
    $('settingsMsg').textContent = `error: ${mutationError(err)}`;
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

// --- Live updates via authenticated, header-capable SSE streaming ---
function handleStreamEvent(type, message) {
  const data = message.data;
  if (type === 'reading') setReading(data);
  if (type === 'door') setDoor(data.state, data.at);
  if (type === 'event') {
    addEvent(data);
    if (data.type === 'flame_alert') setFlame((data.payload || {}).active !== false);
    if (data.type === 'door_change' && data.payload) setDoor(data.payload.state, data.created_at);
  }
  if (type === 'attendance') addAttendance(data);
  if (type === 'settings') applySettings(data);
  if (type === 'command') $('doorCmd').textContent = `command #${data.id} ${data.type} (${data.status})`;
}

function parseStreamBlock(block) {
  let type = 'message';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return;
  try { handleStreamEvent(type, JSON.parse(data.join('\n'))); } catch (_) {}
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForTokenChange = () => new Promise((resolve) => {
  adminInput.addEventListener('input', resolve, { once: true });
});

let dashboardLoaded = false;

async function connectSSE() {
  const setConn = (on, text) => {
    $('connDot').className = 'dot ' + (on ? 'on' : 'off');
    $('connText').textContent = text || (on ? 'live' : 'reconnecting…');
  };

  while (true) {
    if (!adminInput.value.trim()) {
      setConn(false, 'read/admin token required');
      await waitForTokenChange();
      continue;
    }
    try {
      const res = await fetch('/api/stream', { headers: headers(false), cache: 'no-store' });
      if (res.status === 401) {
        setConn(false, 'valid read/admin token required');
        await waitForTokenChange();
        continue;
      }
      if (res.status === 429) {
        const seconds = Number(res.headers.get('Retry-After')) || 5;
        setConn(false, 'rate limited');
        await delay(seconds * 1000);
        continue;
      }
      if (!res.ok) {
        setConn(false, res.status === 503 ? 'read authentication not configured' : 'stream unavailable');
        await delay(5000);
        continue;
      }

      if (!dashboardLoaded) {
        await initialLoad();
        dashboardLoaded = true;
      }
      setConn(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let match;
        while ((match = buffer.match(/\r?\n\r?\n/))) {
          parseStreamBlock(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
      }
      setConn(false);
    } catch (_) {
      setConn(false);
    }
    await delay(3000);
  }
}

connectSSE();