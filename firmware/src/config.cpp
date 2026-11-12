#include "config.h"
#include <Preferences.h>

Config cfg;
static Preferences prefs;
static const char* NS = "sc_cfg";

String configDefaultDeviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "classroom-%02X%02X%02X",
           (uint8_t)(mac >> 16), (uint8_t)(mac >> 8), (uint8_t)mac);
  return String(buf);
}

void configLoad() {
  prefs.begin(NS, true);  // read-only
  cfg.wifiSsid             = prefs.getString("wifi_ssid", "");
  cfg.wifiPass             = prefs.getString("wifi_pass", "");
  cfg.roomId               = prefs.getString("room_id", "");
  cfg.serverUrl            = prefs.getString("server_url", "");
  cfg.deviceToken          = prefs.getString("dev_token", "");
  cfg.deviceId             = prefs.getString("dev_id", configDefaultDeviceId());
  cfg.tempThresholdC       = prefs.getFloat("temp_th", 35.0f);
  cfg.humidityThresholdPct = prefs.getFloat("hum_th", 80.0f);
  cfg.flameResponseLimitMs = prefs.getUInt("flame_ms", 2000);
  cfg.doorAutoLockMs       = prefs.getUInt("autolock_ms", 8000);
  cfg.telemetryIntervalMs  = prefs.getUInt("tele_ms", 5000);
  cfg.commandPollIntervalMs= prefs.getUInt("poll_ms", 3000);
  cfg.studentUids          = prefs.getString("student_uids", "");
  cfg.teacherUids          = prefs.getString("teacher_uids", "");
  prefs.end();
}

void configSave() {
  prefs.begin(NS, false);  // read-write
  prefs.putString("wifi_ssid", cfg.wifiSsid);
  prefs.putString("wifi_pass", cfg.wifiPass);
  prefs.putString("room_id", cfg.roomId);
  prefs.putString("server_url", cfg.serverUrl);
  prefs.putString("dev_token", cfg.deviceToken);
  prefs.putString("dev_id", cfg.deviceId);
  prefs.putFloat("temp_th", cfg.tempThresholdC);
  prefs.putFloat("hum_th", cfg.humidityThresholdPct);
  prefs.putUInt("flame_ms", cfg.flameResponseLimitMs);
  prefs.putUInt("autolock_ms", cfg.doorAutoLockMs);
  prefs.putUInt("tele_ms", cfg.telemetryIntervalMs);
  prefs.putUInt("poll_ms", cfg.commandPollIntervalMs);
  prefs.putString("student_uids", cfg.studentUids);
  prefs.putString("teacher_uids", cfg.teacherUids);
  prefs.end();
}

bool configHasWifi() {
  return cfg.wifiSsid.length() > 0;
}

String uidNormalize(const String& uid) {
  String out;
  for (size_t i = 0; i < uid.length(); i++) {
    char c = uid[i];
    if (c == ' ' || c == ':' || c == '-') continue;
    out += (char)toupper((unsigned char)c);
  }
  return out;
}

static bool uidInList(const String& uid, const String& list) {
  String target = uidNormalize(uid);
  if (target.length() == 0) return false;
  int start = 0;
  while (start < (int)list.length()) {
    int comma = list.indexOf(',', start);
    if (comma < 0) comma = list.length();
    String item = uidNormalize(list.substring(start, comma));
    if (item.length() && item == target) return true;
    start = comma + 1;
  }
  return false;
}

bool uidIsTeacher(const String& uid) { return uidInList(uid, cfg.teacherUids); }
bool uidIsStudent(const String& uid) { return uidInList(uid, cfg.studentUids); }