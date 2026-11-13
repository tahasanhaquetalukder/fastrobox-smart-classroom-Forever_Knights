#include "statuspage.h"
#include "config.h"
#include "state.h"
#include "door.h"
#include "net.h"
#include "sysinfo.h"
#include "version.h"
#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <ESPmDNS.h>

static WebServer server(80);
static bool sStarted = false;
static portMUX_TYPE sCardMux = portMUX_INITIALIZER_UNLOCKED;
static char sLastUid[24] = "none";
static char sLastRole[12] = "-";

static const char* INDEX_HTML = R"HTML(<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Classroom - Local Status</title>
<style>
:root{--bg:#0f172a;--panel:#1e293b;--line:#334155;--text:#e2e8f0;--muted:#94a3b8;--ok:#22c55e;--warn:#eab308;--bad:#ef4444}
*{box-sizing:border-box}body{margin:0;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--text)}
h1{font-size:1.1rem;margin:0 0 4px}.sub{color:var(--muted);font-size:.8rem;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.k{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.v{font-size:1rem;margin-top:2px;word-break:break-word}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:700;font-size:.8rem}
.ok{background:#14532d;color:#86efac}.warn{background:#713f12;color:#fde68a}.bad{background:#7f1d1d;color:#fca5a5}.info{background:#1e3a8a;color:#bfdbfe}
#banner{display:none;background:#7f1d1d;border:1px solid #ef4444;color:#fff;font-weight:800;font-size:1.2rem;text-align:center;padding:14px;border-radius:10px;margin-bottom:12px;letter-spacing:.03em}
#banner.show{display:block;animation:pulse 1s infinite}
@keyframes pulse{50%{background:#b91c1c}}
.foot{margin-top:14px;color:var(--muted);font-size:.72rem}
</style></head><body>
<div id="banner">FIRE &ndash; EVACUATE</div>
<h1>Smart Classroom &mdash; Local Status</h1>
<div class="sub" id="conn">connecting&hellip;</div>
<div class="grid">
  <div class="card"><div class="k">Room</div><div class="v" id="room">--</div></div>
  <div class="card"><div class="k">Time (Asia/Dhaka)</div><div class="v" id="time">--</div></div>
  <div class="card"><div class="k">Overall status</div><div class="v"><span id="status" class="badge info">--</span></div></div>
  <div class="card"><div class="k">Temperature</div><div class="v" id="temp">--</div></div>
  <div class="card"><div class="k">Humidity</div><div class="v" id="rh">--</div></div>
  <div class="card"><div class="k">Heat index / trend</div><div class="v" id="hi">--</div></div>
  <div class="card"><div class="k">Flame</div><div class="v"><span id="flame" class="badge ok">--</span></div></div>
  <div class="card"><div class="k">Door</div><div class="v"><span id="door" class="badge info">--</span></div></div>
  <div class="card"><div class="k">Last card UID</div><div class="v" id="card">none</div></div>
  <div class="card"><div class="k">Wi-Fi RSSI</div><div class="v" id="rssi">--</div></div>
  <div class="card"><div class="k">Chip temperature</div><div class="v" id="chip">--</div></div>
  <div class="card"><div class="k">Firmware</div><div class="v" id="fw">--</div></div>
  <div class="card"><div class="k">IP address</div><div class="v" id="ip">--</div></div>
  <div class="card"><div class="k">mDNS</div><div class="v" id="host">--</div></div>
  <div class="card"><div class="k">Device ID</div><div class="v" id="devid">--</div></div>
  <div class="card"><div class="k">Uptime</div><div class="v" id="uptime">--</div></div>
</div>
<div class="foot" id="foot">--</div>
<script>
const $ = (id) => document.getElementById(id);
function badge(id, text, cls) { const el = $(id); el.textContent = text; el.className = 'badge ' + cls; }
function dhaka(epoch) {
  if (!epoch) return 'syncing...';
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(epoch * 1000)); }
  catch (e) { return new Date(epoch * 1000).toUTCString(); }
}
async function tick() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const s = await res.json();
    $('banner').classList.toggle('show', s.status === 'FIRE');
    $('room').textContent = s.room || '(unset)';
    $('time').textContent = dhaka(s.time);
    badge('status', s.status, s.status === 'SAFE' ? 'ok' : (s.status === 'WARNING' ? 'warn' : 'bad'));
    $('temp').textContent = (s.temp_c == null) ? '--' : s.temp_c.toFixed(1) + ' C';
    $('rh').textContent = (s.rh == null) ? '--' : s.rh.toFixed(0) + ' %';
    $('hi').textContent = ((s.heat_index_c == null) ? '--' : s.heat_index_c.toFixed(1) + ' C') + ' / ' + (s.trend || 'UNKNOWN');
    badge('flame', s.flame ? 'FLAME' : 'Clear', s.flame ? 'bad' : 'ok');
    badge('door', s.door, s.door === 'UNLOCKED' ? 'warn' : 'ok');
    $('card').textContent = s.last_card_uid === 'none' ? 'none' : s.last_card_uid + ' (' + s.last_card_role + ')';
    $('rssi').textContent = s.wifi ? (s.rssi + ' dBm') : 'offline';
    $('chip').textContent = (s.chip_temp_c == null) ? '--' : s.chip_temp_c.toFixed(1) + ' C';
    $('fw').textContent = s.fw;
    $('ip').textContent = s.ip || '--';
    $('host').textContent = s.host || '--';
    $('devid').textContent = s.device_id;
    $('uptime').textContent = s.uptime_s + ' s';
    $('conn').textContent = s.wifi ? ('Wi-Fi connected' + (s.backend ? ' - cloud online' : ' - cloud offline (buffering)')) : 'Wi-Fi offline';
    $('foot').textContent = 'Panic: ' + (s.panic ? 'ACTIVE' : 'clear') +
      ' | Fire latch: ' + (s.fire_latched ? 'latched' : 'clear') +
      ' | Quality: ' + s.quality + ' | Reset: ' + s.reset_reason +
      ' | Heap: ' + s.heap_kb + ' KB | Spool: ' + s.spool;
  } catch (e) {
    $('conn').textContent = 'Local page: connection lost (' + e.message + ')';
  }
}
tick();
setInterval(tick, 2000);
</script></body></html>)HTML";

static bool serveFs(const char* path, const char* mime) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  server.send(200, mime, f.readString());
  f.close();
  return true;
}

static void handleIndex() {
  if (serveFs("/www/index.html", "text/html")) return;
  server.send(200, "text/html", INDEX_HTML);
}

static void handleCss() {
  if (!serveFs("/www/app.css", "text/css")) server.send(404, "text/plain", "not found");
}

static void handleJs() {
  if (!serveFs("/www/app.js", "application/javascript")) server.send(404, "text/plain", "not found");
}

static void handleState() {
  char cardUid[24];
  char cardRole[12];
  portENTER_CRITICAL(&sCardMux);
  strncpy(cardUid, sLastUid, sizeof(cardUid) - 1);
  cardUid[sizeof(cardUid) - 1] = 0;
  strncpy(cardRole, sLastRole, sizeof(cardRole) - 1);
  cardRole[sizeof(cardRole) - 1] = 0;
  portEXIT_CRITICAL(&sCardMux);

  JsonDocument d;
  d["ip"] = WiFi.localIP().toString();
  d["host"] = configMdnsHost() + ".local";
  d["room"] = cfg.roomId;
  d["device_id"] = cfg.deviceId;
  d["time"] = netEpoch();
  d["temp_c"] = stateTempC();
  d["rh"] = stateRhPct();
  d["heat_index_c"] = stateHeatIndexC();
  d["status"] = stateTelemetryStatusStr();
  d["trend"] = stateTrendStr();
  d["quality"] = stateQualityStr();
  d["flame"] = stateFlameDetected();
  d["door"] = doorStateStr();
  d["last_card_uid"] = cardUid;
  d["last_card_role"] = cardRole;
  d["wifi"] = WiFi.status() == WL_CONNECTED;
  d["backend"] = netBackendOnline();
  d["rssi"] = WiFi.RSSI();
  d["chip_temp_c"] = sysChipTempC();
  d["fw"] = FW_VERSION;
  d["uptime_s"] = (uint32_t)(millis() / 1000);
  d["panic"] = statePanicActive();
  d["fire_latched"] = stateFireLatched();
  d["fire_silenced"] = stateFireSilenced();
  d["reset_reason"] = sysResetReason();
  d["heap_kb"] = sysHeapKb();
  d["spool"] = (uint32_t)netSpoolSize();

  String out;
  serializeJson(d, out);
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", out);
}

void statusPageBegin() {
  if (sStarted) return;
  server.on("/", HTTP_GET, handleIndex);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/app.css", HTTP_GET, handleCss);
  server.on("/app.js", HTTP_GET, handleJs);
  server.onNotFound(handleIndex);
  server.begin();
  sStarted = true;
  Serial.printf("[NET] local status page: http://%s/ and http://%s.local/\n",
                WiFi.localIP().toString().c_str(), configMdnsHost().c_str());
}

void statusPageTick() {
  if (sStarted) server.handleClient();
}

void statusPageEnd() {
  if (!sStarted) return;
  server.stop();
  sStarted = false;
}

void statusPageSetLastCard(const String& uid, const String& role) {
  portENTER_CRITICAL(&sCardMux);
  strncpy(sLastUid, uid.c_str(), sizeof(sLastUid) - 1);
  sLastUid[sizeof(sLastUid) - 1] = 0;
  strncpy(sLastRole, role.c_str(), sizeof(sLastRole) - 1);
  sLastRole[sizeof(sLastRole) - 1] = 0;
  portEXIT_CRITICAL(&sCardMux);
}
