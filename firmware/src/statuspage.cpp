#include "statuspage.h"
#include "config.h"
#include "door.h"
#include <WiFi.h>
#include <WebServer.h>

static WebServer server(80);
static float sT = NAN, sH = NAN;
static bool sFlame = false;
static String sLastRfid = "none";

static String html() {
  String ip = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("disconnected");
  String t = isnan(sT) ? String("--") : String(sT, 1);
  String h = isnan(sH) ? String("--") : String(sH, 0);
  String ds = doorStateStr();
  String page =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<meta http-equiv='refresh' content='3'><title>Smart Classroom Status</title>"
    "<style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}"
    "h1{font-size:1.2rem}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155}"
    ".k{color:#94a3b8}.badge{padding:2px 10px;border-radius:999px;font-weight:700}"
    ".ok{background:#14532d;color:#86efac}.alert{background:#7f1d1d;color:#fca5a5}</style></head><body>"
    "<h1>Smart Classroom &mdash; Local Status</h1>";
  page += "<div class='row'><span class='k'>Wi-Fi</span><span>" + ip + "</span></div>";
  page += "<div class='row'><span class='k'>Room ID</span><span>" + (cfg.roomId.length() ? cfg.roomId : String("(unset)")) + "</span></div>";
  page += "<div class='row'><span class='k'>Device ID</span><span>" + cfg.deviceId + "</span></div>";
  page += "<div class='row'><span class='k'>Temperature</span><span>" + t + " &deg;C</span></div>";
  page += "<div class='row'><span class='k'>Humidity</span><span>" + h + " %</span></div>";
  page += "<div class='row'><span class='k'>Flame</span><span class='badge " + String(sFlame ? "alert" : "ok") + "'>" + String(sFlame ? "ALERT" : "Clear") + "</span></div>";
  page += "<div class='row'><span class='k'>Door</span><span class='badge " + String(ds == "UNLOCKED" ? "ok" : "alert") + "'>" + ds + "</span></div>";
  page += "<div class='row'><span class='k'>Last RFID</span><span>" + sLastRfid + "</span></div>";
  page += "<div class='row'><span class='k'>Uptime</span><span>" + String(millis() / 1000) + " s</span></div>";
  page += "<div class='row'><span class='k'>Server</span><span>" + (cfg.serverUrl.length() ? cfg.serverUrl : String("(unset)")) + "</span></div>";
  page += "</body></html>";
  return page;
}

void statusPageBegin() {
  server.on("/", HTTP_GET, []() { server.send(200, "text/html", html()); });
  server.onNotFound([]() { server.send(200, "text/html", html()); });
  server.begin();
  Serial.println("[status] local page on http://" + WiFi.localIP().toString() + "/");
}

void statusPageTick() { server.handleClient(); }
void statusPageUpdate(float t, float h, bool flame) { sT = t; sH = h; sFlame = flame; }
void statusPageSetLastRfid(const String& s) { sLastRfid = s; }