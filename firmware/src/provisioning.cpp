#include "provisioning.h"
#include "config.h"
#include "alerts.h"
#include "heartbeat.h"
#include "pins.h"
#include "version.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>

static WebServer server(80);
static DNSServer dns;

bool provisioningNeeded() {
  return !configHasWifi() || digitalRead(BOOT_PIN) == LOW;
}

static String esc(const String& in) {
  String out;
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else out += c;
  }
  return out;
}

static String form() {
  String p =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>" PROJECT_NAME " Setup</title><style>"
    "body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px;max-width:560px}"
    "h1{font-size:1.15rem;margin:0 0 4px}.sub{color:#94a3b8;font-size:.8rem;margin-bottom:14px}"
    "label{display:block;margin:12px 0 4px;color:#94a3b8;font-size:.8rem}"
    "input,select,textarea{width:100%;padding:9px;border-radius:7px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;box-sizing:border-box;font:inherit}"
    "textarea{min-height:90px;font-family:ui-monospace,monospace;font-size:.75rem}"
    "button{margin-top:18px;padding:11px 16px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:700;width:100%}"
    "button.danger{background:#b91c1c;margin-top:10px}.hint{color:#64748b;font-size:.72rem;margin-top:4px}"
    "h2{font-size:.95rem;margin:22px 0 0;color:#cbd5e1;border-top:1px solid #334155;padding-top:14px}"
    "</style></head><body>"
    "<h1>" PROJECT_NAME " &mdash; Device Setup</h1>"
    "<div class='sub'>AP <b>" + esc(configApSsid()) + "</b> &middot; open <b>http://192.168.4.1/</b> &middot; setup password is printed on the device Serial console.</div>"
    "<form method='POST' action='/save'>"
    "<label>Wi-Fi SSID</label><input name='ssid' list='nets' value='" + esc(cfg.wifiSsid) + "' placeholder='scanning...' required>"
    "<datalist id='nets'></datalist><div class='hint' id='scan'>Scanning nearby networks&hellip;</div>"
    "<label>Wi-Fi password (blank = keep saved)</label><input name='pass' type='password' placeholder='network password'>"
    "<label>Room ID</label><input name='room' value='" + esc(cfg.roomId) + "' placeholder='ROOM-1'>"
    "<label>Cloud server URL</label><input name='server' value='" + esc(cfg.serverUrl) + "' placeholder='https://fastrobox-smart-classroom.onrender.com'>"
    "<label>Device token (from backend)</label><input name='token' type='password' value='" + esc(cfg.deviceToken) + "'>"
    "<label>Device ID</label><input name='devid' value='" + esc(cfg.deviceId) + "'>"
    "<h2>Safety settings</h2>"
    "<label>WARNING temperature (C)</label><input name='temp' type='number' step='0.1' value='" + String(cfg.tempThresholdC, 1) + "'>"
    "<label>WARNING humidity (%)</label><input name='hum' type='number' step='1' value='" + String(cfg.humidityThresholdPct, 0) + "'>"
    "<label>Door auto-lock (ms)</label><input name='autolock' type='number' value='" + String(cfg.doorAutoLockMs) + "'>"
    "<label>Panic touch hold (ms)</label><input name='panic' type='number' value='" + String(cfg.panicTouchMs) + "'>"
    "<h2>RFID access lists</h2>"
    "<label>Student UIDs (comma separated)</label><input name='students' value='" + esc(cfg.studentUids) + "'>"
    "<label>Teacher UIDs (comma separated)</label><input name='teachers' value='" + esc(cfg.teacherUids) + "'>"
    "<h2>HTTPS trust</h2>"
    "<label>Root CA PEM (blank = built-in onrender trust anchor)</label><textarea name='rootca' placeholder='-----BEGIN CERTIFICATE-----'>" + esc(cfg.rootCa) + "</textarea>"
    "<div class='hint'>Certificate validation is always enforced for https:// URLs.</div>"
    "<button type='submit'>Save &amp; Reboot</button></form>"
    "<form method='POST' action='/wipe' onsubmit=\"return confirm('Clear saved Wi-Fi and reboot into setup?');\">"
    "<button class='danger' type='submit'>Clear Wi-Fi &amp; restart setup</button></form>"
    "<script>"
    "fetch('/scan').then(r=>r.json()).then(list=>{"
    "const dl=document.getElementById('nets');"
    "if(!list.length){document.getElementById('scan').textContent='No networks found - type the SSID manually.';return;}"
    "list.forEach(n=>{const o=document.createElement('option');o.value=n.ssid;o.label=n.ssid+'  '+n.rssi+' dBm'+(n.enc?'  (secured)':'  (open)');dl.appendChild(o);});"
    "document.getElementById('scan').textContent=list.length+' networks found. Pick one below or type manually.';"
    "}).catch(e=>{document.getElementById('scan').textContent='Scan failed: '+e;});"
    "</script></body></html>";
  return p;
}

static void handleRoot() { server.send(200, "text/html", form()); }

static void handleScan() {
  int n = WiFi.scanNetworks();
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < n; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = WiFi.SSID(i);
    o["rssi"] = WiFi.RSSI(i);
    o["enc"] = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN) ? 1 : 0;
  }
  WiFi.scanDelete();
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

static void respondSaved(const char* heading, const char* text) {
  String p = "<!DOCTYPE html><html><head><meta charset='utf-8'>"
             "<meta name='viewport' content='width=device-width,initial-scale=1'>"
             "<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}</style>"
             "</head><body><h2>";
  p += heading;
  p += "</h2><p>";
  p += text;
  p += "</p></body></html>";
  server.send(200, "text/html", p);
}

static void handleSave() {
  String ssid = server.arg("ssid");
  ssid.trim();
  if (!ssid.length()) {
    respondSaved("Missing SSID", "Go back and choose a Wi-Fi network.");
    return;
  }
  cfg.wifiSsid = ssid;
  String pass = server.arg("pass");
  if (pass.length()) cfg.wifiPass = pass;
  cfg.roomId = server.arg("room");
  cfg.serverUrl = server.arg("server");
  cfg.serverUrl.trim();
  while (cfg.serverUrl.endsWith("/")) cfg.serverUrl.remove(cfg.serverUrl.length() - 1);
  cfg.deviceToken = server.arg("token");
  if (server.arg("devid").length()) cfg.deviceId = server.arg("devid");
  float temp = server.arg("temp").toFloat();
  float hum = server.arg("hum").toFloat();
  uint32_t autolock = server.arg("autolock").toInt();
  uint32_t panicMs = server.arg("panic").toInt();
  if (temp >= 0 && temp <= 50) cfg.tempThresholdC = temp;
  if (hum >= 0 && hum <= 100) cfg.humidityThresholdPct = hum;
  if (autolock >= 500) cfg.doorAutoLockMs = autolock;
  if (panicMs >= 100) cfg.panicTouchMs = panicMs;
  cfg.studentUids = server.arg("students");
  cfg.teacherUids = server.arg("teachers");
  cfg.rootCa = server.arg("rootca");
  cfg.rootCa.trim();

  configSave();
  Serial.println("[NET] provisioning saved; rebooting");
  Serial.printf("[NET] server=%s room=%s device=%s\n",
                cfg.serverUrl.c_str(), cfg.roomId.c_str(), cfg.deviceId.c_str());
  respondSaved("Saved. Rebooting&hellip;",
               "The device will join your Wi-Fi and start reporting to the cloud.");
  delay(1200);
  ESP.restart();
}

static void handleWipe() {
  configClearWifi();
  Serial.println("[NET] Wi-Fi credentials cleared; rebooting into setup AP");
  respondSaved("Wi-Fi cleared. Rebooting&hellip;", "The setup AP will start again.");
  delay(1200);
  ESP.restart();
}

void provisioningRun() {
  String pass = configEnsureSetupPassword();
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(configApSsid().c_str(), pass.c_str());
  IPAddress ip = WiFi.softAPIP();
  dns.start(53, "*", ip);
  server.on("/", HTTP_GET, handleRoot);
  server.on("/scan", HTTP_GET, handleScan);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/wipe", HTTP_POST, handleWipe);
  server.onNotFound(handleRoot);
  server.begin();

  Serial.println("[NET] ------------------------------------------------");
  Serial.printf("[NET] Setup AP: %s\n", configApSsid().c_str());
  Serial.printf("[NET] Setup password: %s\n", pass.c_str());
  Serial.printf("[NET] Open http://%s/ (captive portal)\n", ip.toString().c_str());
  Serial.println("[NET] ------------------------------------------------");

  alertsSetProvisioning(true);
  while (true) {
    dns.processNextRequest();
    server.handleClient();
    alertsTick();
    hbNet++;
    delay(2);
  }
}
