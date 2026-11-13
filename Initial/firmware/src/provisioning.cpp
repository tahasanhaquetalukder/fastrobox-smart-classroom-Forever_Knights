#include "provisioning.h"
#include "config.h"
#include "door.h"
#include "pins.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>

static WebServer server(80);
static DNSServer dns;

bool provisioningNeeded() {
  return digitalRead(BOOT_PIN) == LOW;
}

static String form() {
  String p =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Smart Classroom Setup</title>"
    "<style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px;max-width:520px}"
    "h1{font-size:1.2rem}label{display:block;margin:10px 0 4px;color:#94a3b8;font-size:.85rem}"
    "input,textarea{width:100%;padding:8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;box-sizing:border-box}"
    "textarea{min-height:150px;font-family:monospace;font-size:.7rem}"
    "button{margin-top:16px;padding:10px 18px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:700;width:100%}"
    ".hint{color:#64748b;font-size:.75rem}</style></head><body>"
    "<h1>Smart Classroom &mdash; Provisioning</h1>"
    "<p class='hint'>Stored on the device (NVS). No credentials are baked into firmware.</p>"
    "<form method='POST' action='/save'>";
  auto field = [&](const char* name, const char* label, const String& val, const char* type, const char* ph) {
    p += "<label>"; p += label; p += "</label><input name='"; p += name;
    p += "' type='"; p += type; p += "' value='"; p += val; p += "' placeholder='"; p += ph; p += "'>";
  };
  field("ssid", "Wi-Fi SSID", cfg.wifiSsid, "text", "your network");
  field("pass", "Wi-Fi Password (blank = keep)", "", "password", "your password");
  field("room", "Room ID", cfg.roomId, "text", "ROOM-1");
  field("server", "Server URL", cfg.serverUrl, "text", "https://your-app.onrender.com");
  p += "<label>HTTPS Root CA (PEM)</label><textarea name='rootca' placeholder='-----BEGIN CERTIFICATE-----'>";
  p += cfg.rootCa;
  p += "</textarea>";
  field("token", "Device Token", cfg.deviceToken, "password", "from backend / Render");
  field("devid", "Device ID", cfg.deviceId, "text", "classroom-01");
  field("temp", "Temp threshold (C)", String(cfg.tempThresholdC), "number", "35");
  field("hum", "Humidity threshold (%)", String(cfg.humidityThresholdPct), "number", "80");
  field("flame", "Flame response limit (ms)", String(cfg.flameResponseLimitMs), "number", "2000");
  field("autolock", "Door auto-lock (ms)", String(cfg.doorAutoLockMs), "number", "8000");
  field("students", "Student UIDs (comma-separated)", cfg.studentUids, "text", "A1B2C3D4,...");
  field("teachers", "Teacher UIDs (comma-separated)", cfg.teacherUids, "text", "04A2B3C4,...");
  p += "<button type='submit'>Save &amp; Reboot</button></form></body></html>";
  return p;
}

static void handleSave() {
  cfg.wifiSsid = server.arg("ssid");
  String pass = server.arg("pass");
  if (pass.length()) cfg.wifiPass = pass;
  cfg.roomId = server.arg("room");
  cfg.serverUrl = server.arg("server");
  cfg.serverUrl.trim();
  while (cfg.serverUrl.endsWith("/")) cfg.serverUrl.remove(cfg.serverUrl.length() - 1);
  cfg.rootCa = server.arg("rootca");
  cfg.rootCa.trim();
  if (cfg.rootCa.length()) cfg.rootCa += "\n";
  cfg.deviceToken = server.arg("token");
  if (server.arg("devid").length()) cfg.deviceId = server.arg("devid");
  cfg.tempThresholdC = server.arg("temp").toFloat();
  cfg.humidityThresholdPct = server.arg("hum").toFloat();
  cfg.flameResponseLimitMs = server.arg("flame").toInt();
  cfg.doorAutoLockMs = server.arg("autolock").toInt();
  cfg.studentUids = server.arg("students");
  cfg.teacherUids = server.arg("teachers");
  configSave();
  server.send(200, "text/html",
    "<html><body style='font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:20px'>"
    "<h2>Saved. Rebooting&hellip;</h2><p>The device will join your Wi-Fi and start reporting.</p></body></html>");
  Serial.println("[prov] config saved; rebooting");
  delay(1200);
  ESP.restart();
}

void provisioningRun() {
  ledSet(LED_PROVISIONING);
  WiFi.mode(WIFI_AP);
  uint64_t mac = ESP.getEfuseMac();
  char ssid[32];
  snprintf(ssid, sizeof(ssid), "SmartClassroom-%02X%02X", (uint8_t)(mac >> 8), (uint8_t)mac);
  WiFi.softAP(ssid);
  IPAddress ip = WiFi.softAPIP();
  dns.start(53, "*", ip);
  server.on("/", HTTP_GET, []() { server.send(200, "text/html", form()); });
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound([]() { server.send(200, "text/html", form()); });
  server.begin();
  Serial.printf("[prov] AP '%s' open http://%s/\n", ssid, ip.toString().c_str());
  while (true) {
    dns.processNextRequest();
    server.handleClient();
    delay(2);
  }
}