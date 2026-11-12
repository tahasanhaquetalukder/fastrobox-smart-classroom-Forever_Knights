#include "net.h"
#include "config.h"
#include "door.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <deque>

// Offline event spool: bounded RAM ring + LittleFS persistence so events
// survive both network loss and power loss, then flush on reconnect.
static std::deque<String> spool;
static const size_t SPOOL_MAX = 100;
static const char* SPOOL_PATH = "/spool.jsonl";

static uint32_t lastTelemetry = 0, lastPoll = 0, lastFlush = 0, lastSettings = 0;

bool netOnline() { return WiFi.status() == WL_CONNECTED && cfg.serverUrl.length() > 0; }

static void persistSpool() {
  File f = LittleFS.open(SPOOL_PATH, "w");
  if (!f) return;
  for (auto& s : spool) f.println(s);
  f.close();
}

static void loadSpool() {
  File f = LittleFS.open(SPOOL_PATH, "r");
  if (!f) return;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length()) spool.push_back(line);
  }
  f.close();
  while (spool.size() > SPOOL_MAX) spool.pop_front();
}

static void spoolAppend(const String& body) {
  if (spool.size() >= SPOOL_MAX) spool.pop_front();
  spool.push_back(body);
  persistSpool();
  Serial.printf("[net] offline: buffered event (%u queued)\n", (unsigned)spool.size());
}

void netBegin() {
  if (!LittleFS.begin(true)) Serial.println("[net] LittleFS mount failed");
  loadSpool();
  Serial.printf("[net] ready; %u buffered events\n", (unsigned)spool.size());
}

static bool httpRequest(const char* method, const String& path, const String& body, String& resp) {
  if (WiFi.status() != WL_CONNECTED || cfg.serverUrl.length() == 0) return false;
  WiFiClientSecure client;
  client.setInsecure();  // demo: accept server cert without pinning (see docs/architecture.md)
  HTTPClient http;
  String url = cfg.serverUrl + path;
  if (!http.begin(client, url)) return false;
  http.addHeader("X-Device-Token", cfg.deviceToken);
  http.addHeader("X-Device-Id", cfg.deviceId);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = (strcmp(method, "GET") == 0) ? http.GET() : http.POST(body);
  bool ok = code >= 200 && code < 300;
  if (ok) resp = http.getString();
  else Serial.printf("[net] %s %s -> %d\n", method, path.c_str(), code);
  http.end();
  return ok;
}

void netSendTelemetry(float t, float h, bool flame, const char* doorState) {
  if (!netOnline()) return;
  JsonDocument doc;
  doc["deviceId"] = cfg.deviceId;
  doc["roomId"] = cfg.roomId;
  if (!isnan(t)) doc["temperature"] = t;
  if (!isnan(h)) doc["humidity"] = h;
  doc["flame"] = flame;
  doc["doorState"] = doorState;
  doc["rssi"] = WiFi.RSSI();
  doc["uptimeMs"] = (uint64_t)millis();
  String body; serializeJson(doc, body);
  String resp;
  httpRequest("POST", "/api/device/telemetry", body, resp);
}

void netSendEvent(const char* type, JsonDocument& payload) {
  JsonDocument doc;
  doc["type"] = type;
  doc["roomId"] = cfg.roomId;
  doc["deviceTs"] = (uint64_t)millis();
  doc["payload"] = payload.as<JsonObject>();
  String body; serializeJson(doc, body);
  String resp;
  if (netOnline() && httpRequest("POST", "/api/device/events", body, resp)) {
    Serial.printf("[net] event sent: %s\n", type);
  } else {
    spoolAppend(body);
  }
}

void netFlush() {
  if (!netOnline() || spool.empty()) return;
  JsonDocument batch;
  JsonArray arr = batch["events"].to<JsonArray>();
  for (auto& s : spool) {
    JsonDocument ev;
    if (deserializeJson(ev, s) == DeserializationError::Ok) arr.add(ev.as<JsonObject>());
  }
  String body; serializeJson(batch, body);
  String resp;
  if (httpRequest("POST", "/api/device/events", body, resp)) {
    Serial.printf("[net] flushed %u buffered events\n", (unsigned)spool.size());
    spool.clear();
    LittleFS.remove(SPOOL_PATH);
  }
}

// Merge backend / command settings into runtime config and persist.
static void applySettings(JsonObject s) {
  if (!s["room_id"].isNull()) cfg.roomId = s["room_id"].as<String>();
  if (!s["temp_threshold_c"].isNull()) cfg.tempThresholdC = s["temp_threshold_c"].as<float>();
  if (!s["humidity_threshold_pct"].isNull()) cfg.humidityThresholdPct = s["humidity_threshold_pct"].as<float>();
  if (!s["flame_response_limit_ms"].isNull()) cfg.flameResponseLimitMs = s["flame_response_limit_ms"].as<uint32_t>();
  if (!s["door_auto_lock_ms"].isNull()) cfg.doorAutoLockMs = s["door_auto_lock_ms"].as<uint32_t>();
  if (!s["telemetry_interval_ms"].isNull()) cfg.telemetryIntervalMs = s["telemetry_interval_ms"].as<uint32_t>();
  if (!s["command_poll_interval_ms"].isNull()) cfg.commandPollIntervalMs = s["command_poll_interval_ms"].as<uint32_t>();
  if (!s["student_uids"].isNull()) cfg.studentUids = s["student_uids"].as<String>();
  if (!s["teacher_uids"].isNull()) cfg.teacherUids = s["teacher_uids"].as<String>();
  configSave();
}

void netFetchSettings() {
  if (!netOnline()) return;
  String resp;
  if (!httpRequest("GET", "/api/settings", "", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
  applySettings(doc["settings"].as<JsonObject>());
  Serial.println("[net] settings synced from backend");
}

void netPollCommands() {
  if (!netOnline()) return;
  String resp;
  if (!httpRequest("GET", "/api/device/commands", "", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
  for (JsonObject c : doc["commands"].as<JsonArray>()) {
    const char* type = c["type"] | "";
    long id = c["id"] | 0;
    Serial.printf("[net] command #%ld %s\n", id, type);
    if (strcmp(type, "lock") == 0) doorLock();
    else if (strcmp(type, "unlock") == 0) doorUnlock(cfg.doorAutoLockMs);
    else if (strcmp(type, "set_config") == 0) applySettings(c["payload"].as<JsonObject>());
    else if (strcmp(type, "reboot") == 0) { Serial.println("[net] reboot command"); delay(200); ESP.restart(); }
    JsonDocument ack; ack["status"] = "acked";
    String ab; serializeJson(ack, ab);
    String ar;
    httpRequest("POST", "/api/device/commands/" + String(id) + "/ack", ab, ar);
  }
}

void netTick(float t, float h, bool flame) {
  uint32_t now = millis();
  if (now - lastTelemetry >= cfg.telemetryIntervalMs) { lastTelemetry = now; netSendTelemetry(t, h, flame, doorStateStr()); }
  if (now - lastPoll >= cfg.commandPollIntervalMs) { lastPoll = now; netPollCommands(); }
  if (now - lastFlush >= 5000) { lastFlush = now; netFlush(); }
  if (now - lastSettings >= 30000) { lastSettings = now; netFetchSettings(); }
}