#include "net.h"
#include "config.h"
#include "state.h"
#include "door.h"
#include "alerts.h"
#include "statuspage.h"
#include "provisioning.h"
#include "sysinfo.h"
#include "version.h"
#include "pins.h"
#include "trustca.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <ESPmDNS.h>
#include <time.h>
#include <math.h>
#include <deque>

// ---------------------------------------------------------------------------
// Event outbox / LittleFS spool
// ---------------------------------------------------------------------------
static std::deque<String> sOutbox;
static SemaphoreHandle_t sMux = nullptr;
static TaskHandle_t sNetTask = nullptr;
static const size_t OUTBOX_MAX = 100;
static const char* SPOOL_PATH = "/spool.jsonl";

static void ensureMux() {
  if (!sMux) sMux = xSemaphoreCreateMutex();
}

static void persistLocked() {
  if (sOutbox.empty()) {
    LittleFS.remove(SPOOL_PATH);
    return;
  }
  File f = LittleFS.open(SPOOL_PATH, "w");
  if (!f) return;
  for (auto& s : sOutbox) f.println(s);
  f.close();
}

static void outboxPush(const String& json) {
  ensureMux();
  xSemaphoreTake(sMux, portMAX_DELAY);
  while (sOutbox.size() >= OUTBOX_MAX) sOutbox.pop_front();
  sOutbox.push_back(json);
  persistLocked();
  xSemaphoreGive(sMux);
  if (sNetTask) xTaskNotifyGive(sNetTask);
}

static bool outboxPeek(String& out) {
  if (!sMux) return false;
  xSemaphoreTake(sMux, portMAX_DELAY);
  bool has = !sOutbox.empty();
  if (has) out = sOutbox.front();
  xSemaphoreGive(sMux);
  return has;
}

static void outboxPop() {
  if (!sMux) return;
  xSemaphoreTake(sMux, portMAX_DELAY);
  if (!sOutbox.empty()) sOutbox.pop_front();
  persistLocked();
  xSemaphoreGive(sMux);
}

static void loadSpool() {
  sOutbox.clear();
  File f = LittleFS.open(SPOOL_PATH, "r");
  if (!f) return;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length()) sOutbox.push_back(line);
  }
  f.close();
  while (sOutbox.size() > OUTBOX_MAX) sOutbox.pop_front();
}

size_t netSpoolSize() {
  if (!sMux) return 0;
  xSemaphoreTake(sMux, portMAX_DELAY);
  size_t n = sOutbox.size();
  xSemaphoreGive(sMux);
  return n;
}

// ---------------------------------------------------------------------------
// State / time helpers
// ---------------------------------------------------------------------------
static bool sBackendOnline = false;
static uint32_t sLastOk = 0;
static uint32_t sLastOfflineReport = 0;
static bool sTimeWasReady = false;

uint32_t netEpoch() {
  time_t t = time(nullptr);
  return (t > 1600000000) ? (uint32_t)t : 0;
}

bool netTimeReady() { return netEpoch() > 0; }
bool netBackendOnline() { return sBackendOnline; }
bool netOnline() { return WiFi.status() == WL_CONNECTED && sBackendOnline; }

static void markBackendOk() {
  sLastOk = millis();
  if (!sBackendOnline) {
    sBackendOnline = true;
    Serial.println("[NET] backend online");
  }
}

// ---------------------------------------------------------------------------
// HTTP with certificate validation (never setInsecure for https://)
// ---------------------------------------------------------------------------
static bool httpRequest(const char* method, const String& path, const String& body,
                        String& resp, int* statusCode = nullptr) {
  if (WiFi.status() != WL_CONNECTED || cfg.serverUrl.length() == 0) return false;
  String url = cfg.serverUrl + path;
  bool https = url.startsWith("https://");

  HTTPClient http;
  WiFiClient plain;
  WiFiClientSecure secure;
  bool begun = false;
  if (https) {
    const char* ca = cfg.rootCa.length() > 32 ? cfg.rootCa.c_str() : DEFAULT_ROOT_CA;
    if (cfg.rootCa.length() > 32 && cfg.rootCa.indexOf("BEGIN CERTIFICATE") < 0) {
      Serial.println("[ERROR] stored root CA is not a PEM certificate; using built-in trust anchor");
      ca = DEFAULT_ROOT_CA;
    }
    secure.setCACert(ca);
    secure.setHandshakeTimeout(4);
    begun = http.begin(secure, url);
  } else {
    begun = http.begin(plain, url);
  }
  if (!begun) {
    Serial.printf("[NET] cannot begin request: %s\n", url.c_str());
    return false;
  }

  http.addHeader("X-Device-Token", cfg.deviceToken);
  http.addHeader("X-Device-Id", cfg.deviceId);
  http.addHeader("Content-Type", "application/json");
  http.setConnectTimeout(4000);
  http.setTimeout(5000);
  int code = (strcmp(method, "GET") == 0) ? http.GET() : http.POST(body);
  bool ok = code >= 200 && code < 300;
  if (ok) {
    resp = http.getString();
    markBackendOk();
  } else if (code < 0) {
    Serial.printf("[ERROR] %s %s failed: %s\n", method, path.c_str(), http.errorToString(code).c_str());
  } else {
    Serial.printf("[NET] %s %s -> %d %s\n", method, path.c_str(), code, https ? "(TLS verified)" : "");
    if (code == 409) markBackendOk();  // duplicate replay is still a valid, authenticated response
  }
  if (statusCode) *statusCode = code;
  http.end();
  return ok;
}

// ---------------------------------------------------------------------------
// Event queue API
// ---------------------------------------------------------------------------
void netQueueEvent(const char* type, const char* detail, JsonDocument& payload) {
  JsonDocument env;
  env["device_id"] = cfg.deviceId;
  env["room_id"] = cfg.roomId;
  uint32_t seq = configNextSeq();
  env["seq"] = seq;
  uint32_t ts = netEpoch();
  if (ts) env["ts"] = ts;
  env["type"] = type;
  if (detail && *detail) env["detail"] = detail;

  String ps;
  serializeJson(payload, ps);
  if (ps.length() && ps != "null") {
    JsonDocument tmp;
    if (deserializeJson(tmp, ps) == DeserializationError::Ok) env["payload"] = tmp.as<JsonObject>();
    else env["payload"].to<JsonObject>();
  } else {
    env["payload"].to<JsonObject>();
  }

  String out;
  serializeJson(env, out);
  outboxPush(out);
  Serial.printf("[EVENT] %s seq=%u%s%s\n", type, (unsigned)seq,
                (detail && *detail) ? " " : "", (detail && *detail) ? detail : "");
}

void netQueueEvent(const char* type, const char* detail) {
  JsonDocument empty;
  netQueueEvent(type, detail, empty);
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------
static float finiteOr(float v, float fallback) { return isnan(v) ? fallback : v; }

static void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;
  float t = finiteOr(stateTempC(), stateLastValidTempC());
  float h = finiteOr(stateRhPct(), stateLastValidRhPct());
  if (isnan(t)) t = 0;
  if (isnan(h)) h = 0;

  JsonDocument d;
  d["device_id"] = cfg.deviceId;
  d["room_id"] = cfg.roomId;
  d["seq"] = configNextSeq();
  uint32_t ts = netEpoch();
  if (ts) d["ts"] = ts;
  d["uptime_s"] = (uint32_t)(millis() / 1000);
  d["temp_c"] = t;
  d["rh"] = h;
  if (!isnan(stateHeatIndexC())) d["heat_index_c"] = stateHeatIndexC();
  d["flame"] = stateFlameDetected();
  d["door"] = doorStateStr();
  d["status"] = stateTelemetryStatusStr();
  if (stateHeatTrend() != TREND_UNKNOWN) d["heat_trend"] = stateTrendStr();
  d["rssi"] = WiFi.RSSI();
  d["heap_kb"] = sysHeapKb();
  d["chip_temp_c"] = sysChipTempC();
  d["fw"] = FW_VERSION;
  d["quality"] = stateQualityGood() ? "good" : "bad";
  d["reset_reason"] = sysResetReason();

  String body;
  serializeJson(d, body);
  String resp;
  httpRequest("POST", "/api/device/telemetry", body, resp);
}

// ---------------------------------------------------------------------------
// Commands / settings
// ---------------------------------------------------------------------------
static bool setFloatSetting(JsonObject s, const char* key, float& field, float lo, float hi) {
  if (s[key].isNull()) return false;
  float v = s[key].as<float>();
  if (v < lo || v > hi) return false;
  if (fabsf(v - field) < 0.0001f) return false;
  field = v;
  return true;
}

static bool setUintSetting(JsonObject s, const char* key, uint32_t& field, uint32_t lo, uint32_t hi) {
  if (s[key].isNull()) return false;
  long v = s[key].as<long>();
  if (v < (long)lo || v > (long)hi) return false;
  if ((uint32_t)v == field) return false;
  field = (uint32_t)v;
  return true;
}

bool netApplySettings(JsonObject s) {
  if (s.isNull()) return false;
  bool changed = false;
  changed |= setFloatSetting(s, "temp_threshold_c", cfg.tempThresholdC, 0, 50);
  changed |= setFloatSetting(s, "humidity_threshold_pct", cfg.humidityThresholdPct, 0, 100);
  changed |= setFloatSetting(s, "danger_temp_c", cfg.dangerTempC, 0, 60);
  changed |= setFloatSetting(s, "danger_exit_temp_c", cfg.dangerExitTempC, 0, 60);
  changed |= setFloatSetting(s, "warn_exit_temp_c", cfg.warnExitTempC, 0, 60);
  changed |= setFloatSetting(s, "warn_exit_humidity_pct", cfg.warnExitHumidityPct, 0, 100);
  changed |= setUintSetting(s, "flame_response_limit_ms", cfg.flameResponseLimitMs, 100, 600000);
  if (!s["fire_confirm_ms"].isNull()) {
    uint32_t v = s["fire_confirm_ms"].as<uint32_t>();
    if (v >= 100 && v <= 600000 && v != cfg.flameResponseLimitMs) {
      cfg.flameResponseLimitMs = v;
      changed = true;
    }
  }
  changed |= setUintSetting(s, "panic_touch_ms", cfg.panicTouchMs, 100, 600000);
  changed |= setUintSetting(s, "door_auto_lock_ms", cfg.doorAutoLockMs, 500, 3600000);
  changed |= setUintSetting(s, "telemetry_interval_ms", cfg.telemetryIntervalMs, 1000, 3600000);
  changed |= setUintSetting(s, "command_poll_interval_ms", cfg.commandPollIntervalMs, 250, 3600000);
  if (!s["student_uids"].isNull()) {
    String v = s["student_uids"].as<String>();
    if (v != cfg.studentUids) { cfg.studentUids = v; changed = true; }
  }
  if (!s["teacher_uids"].isNull()) {
    String v = s["teacher_uids"].as<String>();
    if (v != cfg.teacherUids) { cfg.teacherUids = v; changed = true; }
  }
  if (changed) {
    configSave();
    Serial.println("[NET] settings applied from backend");
  }
  return changed;
}

static void fetchSettings() {
  String resp;
  if (!httpRequest("GET", "/api/settings", "", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
  JsonObject s = doc["settings"].as<JsonObject>();
  bool changed = netApplySettings(s);
  if (changed) {
    JsonDocument p;
    p["source"] = "backend";
    netQueueEvent("SETTINGS_APPLIED", "Settings synced from backend", p);
  }
}

static void pollCommands() {
  String resp;
  if (!httpRequest("GET", "/api/device/commands", "", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;

  for (JsonObject c : doc["commands"].as<JsonArray>()) {
    const char* type = c["type"] | "";
    long id = c["id"] | 0L;
    JsonObject payload = c["payload"].as<JsonObject>();
    bool ok = true;
    String detail = "applied";
    bool reboot = false;

    if (strcmp(type, "lock") == 0) {
      if (stateFireLatched()) { ok = false; detail = "fire latch active"; }
      else doorLock();
    } else if (strcmp(type, "unlock") == 0) {
      doorUnlock(cfg.doorAutoLockMs);
    } else if (strcmp(type, "fire_reset") == 0) {
      if (stateFlameDetected()) { ok = false; detail = "flame still detected"; }
      else if (!stateClearFire()) { ok = false; detail = "fire is not latched"; }
      else {
        doorLock();
        JsonDocument p;
        p["source"] = "authorized backend command";
        netQueueEvent("STATUS", "Fire reset authorized; latch cleared", p);
        Serial.println("[STATUS] fire reset authorized; door re-locked");
      }
    } else if (strcmp(type, "silence_fire") == 0) {
      if (!stateSilenceFire()) { ok = false; detail = "flame present or fire not latched"; }
      else {
        JsonDocument p;
        p["source"] = "authorized backend command";
        netQueueEvent("SILENCED", "Fire alarm silenced", p);
        Serial.println("[STATUS] fire alarm silenced");
      }
    } else if (strcmp(type, "set_config") == 0) {
      bool changed = netApplySettings(payload);
      JsonDocument p;
      p["source"] = "command";
      p["changed"] = changed;
      netQueueEvent("SETTINGS_APPLIED", "Configuration command applied", p);
    } else if (strcmp(type, "reboot") == 0) {
      reboot = true;
      detail = "rebooting";
    } else {
      ok = false;
      detail = "unsupported command";
    }

    JsonDocument ack;
    ack["status"] = ok ? "acked" : "rejected";
    ack["detail"] = detail;
    String ab;
    serializeJson(ack, ab);
    String ar;
    httpRequest("POST", String("/api/device/commands/") + String(id) + "/ack", ab, ar);
    Serial.printf("[NET] command #%ld %s -> %s\n", id, type, ok ? "acked" : "rejected");
    if (reboot) {
      delay(300);
      ESP.restart();
    }
  }
}

// ---------------------------------------------------------------------------
// Wi-Fi / NTP / mDNS
// ---------------------------------------------------------------------------
static uint32_t sLastAttempt = 0;
static uint32_t sBackoffMs = 2000;
static bool sWasConnected = false;
static uint32_t sAuthFailSince = 0;
static bool sMdnsStarted = false;
static uint32_t sLastNtpTry = 0;

static void startMdns() {
  if (sMdnsStarted) return;
  String host = configMdnsHost();
  if (MDNS.begin(host.c_str())) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("[NET] mDNS ready: http://%s.local/\n", host.c_str());
    sMdnsStarted = true;
  } else {
    Serial.println("[ERROR] mDNS failed to start");
  }
}

static void stopMdns() {
  if (!sMdnsStarted) return;
  MDNS.end();
  sMdnsStarted = false;
}

static void ntpEnsure(uint32_t now) {
  if (netTimeReady()) {
    if (!sTimeWasReady) {
      sTimeWasReady = true;
      Serial.printf("[NET] NTP synced (UTC epoch %u)\n", (unsigned)netEpoch());
    }
    return;
  }
  if (now - sLastNtpTry < 10000) return;
  sLastNtpTry = now;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
}

static void wifiEnsure(uint32_t now) {
  wl_status_t st = WiFi.status();
  if (st == WL_CONNECTED) {
    if (!sWasConnected) {
      sWasConnected = true;
      sBackoffMs = 2000;
      sAuthFailSince = 0;
      Serial.printf("[NET] Wi-Fi connected: ip=%s rssi=%d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      alertsSetWifiOnline(true);
      startMdns();
    }
    return;
  }

  if (sWasConnected) {
    Serial.println("[NET] Wi-Fi lost; retrying without restart");
    sWasConnected = false;
    alertsSetWifiOnline(false);
    stopMdns();
  }

  if (st == WL_CONNECT_FAILED) {
    if (!sAuthFailSince) sAuthFailSince = now;
    if (now - sAuthFailSince > 15000) {
      Serial.println("[NET] unrecoverable Wi-Fi failure (authentication); starting setup AP");
      statusPageEnd();
      alertsSetWifiOnline(false);
      alertsSetProvisioning(true);
      provisioningRun();  // blocks until the user saves and the device reboots
    }
  } else {
    sAuthFailSince = 0;
  }

  if (now - sLastAttempt < sBackoffMs) return;
  sLastAttempt = now;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.begin(cfg.wifiSsid.c_str(), cfg.wifiPass.c_str());
  Serial.printf("[NET] connecting to '%s' (next attempt in %lus)\n",
                cfg.wifiSsid.c_str(), (unsigned long)(sBackoffMs / 1000));
  sBackoffMs = sBackoffMs < 60000 ? sBackoffMs * 2 : 60000;
  if (sBackoffMs > 60000) sBackoffMs = 60000;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
static uint32_t sLastTelemetry = 0;
static uint32_t sLastPoll = 0;
static uint32_t sLastSettings = 0;
static bool sBootEventSent = false;
static bool sOfflineReported = false;

static bool sendOneOutbox() {
  String body;
  if (!outboxPeek(body)) return false;
  String resp;
  int code = 0;
  if (httpRequest("POST", "/api/device/events", body, resp, &code)) {
    outboxPop();
    return true;
  }
  if (code == 409) {
    outboxPop();  // duplicate event already stored by the backend
    return true;
  }
  return false;
}

void netBegin() {
  ensureMux();
  if (!LittleFS.begin(true)) Serial.println("[ERROR] LittleFS mount failed");
  loadSpool();
  configEnsureSetupPassword();
  Serial.printf("[NET] ready; %u buffered event(s) in spool\n", (unsigned)sOutbox.size());
  sLastAttempt = millis();
}

void netLoop() {
  sNetTask = xTaskGetCurrentTaskHandle();
  uint32_t now = millis();

  wifiEnsure(now);
  if (WiFi.status() != WL_CONNECTED) {
    if (sBackendOnline) sBackendOnline = false;
    alertsSetWifiOnline(false);
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(50));
    return;
  }

  ntpEnsure(now);
  alertsSetWifiOnline(true);

  if (!sBootEventSent) {
    sBootEventSent = true;
    JsonDocument p;
    p["ip"] = WiFi.localIP().toString();
    p["reset_reason"] = sysResetReason();
    p["fw"] = FW_VERSION;
    netQueueEvent("BOOT", "Device booted", p);
  }

  if (sendOneOutbox()) {
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(10));
    return;
  }

  if (now - sLastTelemetry >= cfg.telemetryIntervalMs) {
    sLastTelemetry = now;
    sendTelemetry();
  }
  if (now - sLastPoll >= cfg.commandPollIntervalMs) {
    sLastPoll = now;
    pollCommands();
  }
  if (now - sLastSettings >= 30000) {
    sLastSettings = now;
    fetchSettings();
  }

  if (sBackendOnline && now - sLastOk > 30000) {
    sBackendOnline = false;
    Serial.println("[NET] backend offline (>30s); events are buffered");
  }
  if (!sBackendOnline && !sOfflineReported && now > 30000) {
    sOfflineReported = true;
    Serial.println("[NET] backend unreachable (>30s); will resume automatically");
  }
  if (sBackendOnline) sOfflineReported = false;

  ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(50));
}
