#include "config.h"
#include "version.h"
#include <Preferences.h>
#include <esp_system.h>

Config cfg;
static Preferences prefs;
static const char* NS = "sc_cfg";
static portMUX_TYPE seqMux = portMUX_INITIALIZER_UNLOCKED;

String configDefaultDeviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "classroom-%02X%02X%02X",
           (uint8_t)(mac >> 16), (uint8_t)(mac >> 8), (uint8_t)mac);
  return String(buf);
}

void configLoad() {
  prefs.begin(NS, true);
  cfg.wifiSsid              = prefs.getString("wifi_ssid", "");
  cfg.wifiPass              = prefs.getString("wifi_pass", "");
  cfg.roomId                = prefs.getString("room_id", "");
  cfg.serverUrl             = prefs.getString("server_url", "");
  cfg.deviceToken           = prefs.getString("dev_token", "");
  cfg.deviceId              = prefs.getString("dev_id", configDefaultDeviceId());
  cfg.setupPassword         = prefs.getString("setup_pw", "");
  cfg.rootCa                = prefs.getString("root_ca", "");
  cfg.studentUids           = prefs.getString("student_uids", "");
  cfg.teacherUids           = prefs.getString("teacher_uids", "");
  cfg.tempThresholdC        = prefs.getFloat("temp_th", 32.0f);
  cfg.humidityThresholdPct  = prefs.getFloat("hum_th", 85.0f);
  cfg.dangerTempC           = prefs.getFloat("danger_t", 40.0f);
  cfg.dangerExitTempC       = prefs.getFloat("danger_exit", 38.0f);
  cfg.warnExitTempC         = prefs.getFloat("warn_exit_t", 30.0f);
  cfg.warnExitHumidityPct   = prefs.getFloat("warn_exit_h", 80.0f);
  cfg.flameResponseLimitMs  = prefs.getUInt("fire_ms", 2000);
  cfg.panicTouchMs          = prefs.getUInt("panic_ms", 2000);
  cfg.doorAutoLockMs        = prefs.getUInt("autolock_ms", 8000);
  cfg.telemetryIntervalMs   = prefs.getUInt("tele_ms", 5000);
  cfg.commandPollIntervalMs = prefs.getUInt("poll_ms", 3000);
  cfg.seqReserved           = prefs.getUInt("seq_high", 0);
  cfg.seqCounter            = cfg.seqReserved;
  cfg.fireLatched           = prefs.getBool("fire_latch", false);
  cfg.fireSilenced          = prefs.getBool("fire_sil", false);
  cfg.panicBaseline         = prefs.getUShort("panic_base", 0);
  prefs.end();

  while (cfg.serverUrl.endsWith("/")) cfg.serverUrl.remove(cfg.serverUrl.length() - 1);
  if (cfg.telemetryIntervalMs < 1000) cfg.telemetryIntervalMs = 1000;
  if (cfg.commandPollIntervalMs < 250) cfg.commandPollIntervalMs = 250;
  if (cfg.flameResponseLimitMs < 100) cfg.flameResponseLimitMs = 100;
  if (cfg.panicTouchMs < 100) cfg.panicTouchMs = 100;
  if (cfg.doorAutoLockMs < 500) cfg.doorAutoLockMs = 500;
  if (!cfg.deviceId.length()) cfg.deviceId = configDefaultDeviceId();
}

void configSave() {
  prefs.begin(NS, false);
  prefs.putString("wifi_ssid", cfg.wifiSsid);
  prefs.putString("wifi_pass", cfg.wifiPass);
  prefs.putString("room_id", cfg.roomId);
  prefs.putString("server_url", cfg.serverUrl);
  prefs.putString("dev_token", cfg.deviceToken);
  prefs.putString("dev_id", cfg.deviceId);
  prefs.putString("setup_pw", cfg.setupPassword);
  prefs.putString("root_ca", cfg.rootCa);
  prefs.putString("student_uids", cfg.studentUids);
  prefs.putString("teacher_uids", cfg.teacherUids);
  prefs.putFloat("temp_th", cfg.tempThresholdC);
  prefs.putFloat("hum_th", cfg.humidityThresholdPct);
  prefs.putFloat("danger_t", cfg.dangerTempC);
  prefs.putFloat("danger_exit", cfg.dangerExitTempC);
  prefs.putFloat("warn_exit_t", cfg.warnExitTempC);
  prefs.putFloat("warn_exit_h", cfg.warnExitHumidityPct);
  prefs.putUInt("fire_ms", cfg.flameResponseLimitMs);
  prefs.putUInt("panic_ms", cfg.panicTouchMs);
  prefs.putUInt("autolock_ms", cfg.doorAutoLockMs);
  prefs.putUInt("tele_ms", cfg.telemetryIntervalMs);
  prefs.putUInt("poll_ms", cfg.commandPollIntervalMs);
  prefs.putUShort("panic_base", cfg.panicBaseline);
  prefs.end();
}

void configSaveWifi() {
  prefs.begin(NS, false);
  prefs.putString("wifi_ssid", cfg.wifiSsid);
  prefs.putString("wifi_pass", cfg.wifiPass);
  prefs.putString("room_id", cfg.roomId);
  prefs.putString("server_url", cfg.serverUrl);
  prefs.putString("dev_token", cfg.deviceToken);
  prefs.putString("dev_id", cfg.deviceId);
  prefs.putString("root_ca", cfg.rootCa);
  prefs.end();
}

void configSaveFireState() {
  prefs.begin(NS, false);
  prefs.putBool("fire_latch", cfg.fireLatched);
  prefs.putBool("fire_sil", cfg.fireSilenced);
  prefs.end();
}

bool configHasWifi() { return cfg.wifiSsid.length() > 0; }

String configTeamId() { return String(TEAM_ID); }

String configApSsid() {
  String s = String("SmartClass-") + TEAM_ID;
  if (s.length() > 32) s = s.substring(0, 32);
  return s;
}

String configMdnsHost() {
  String out = String(MDNS_PREFIX);
  for (size_t i = 0; i < strlen(TEAM_ID); i++) {
    char c = TEAM_ID[i];
    if (isalnum((unsigned char)c)) out += (char)tolower((unsigned char)c);
  }
  if (out.length() <= strlen(MDNS_PREFIX)) out += "device";
  return out;
}

String configEnsureSetupPassword() {
  if (cfg.setupPassword.length() == 8) return cfg.setupPassword;
  static const char alphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  String p;
  for (int i = 0; i < 8; i++) p += alphabet[esp_random() % (sizeof(alphabet) - 1)];
  cfg.setupPassword = p;
  prefs.begin(NS, false);
  prefs.putString("setup_pw", cfg.setupPassword);
  prefs.end();
  return cfg.setupPassword;
}

void configClearWifi() {
  cfg.wifiSsid = "";
  cfg.wifiPass = "";
  prefs.begin(NS, false);
  prefs.putString("wifi_ssid", "");
  prefs.putString("wifi_pass", "");
  prefs.end();
}

uint32_t configNextSeq() {
  uint32_t s;
  uint32_t reserve = 0;
  portENTER_CRITICAL(&seqMux);
  s = ++cfg.seqCounter;
  if (cfg.seqCounter >= cfg.seqReserved) {
    cfg.seqReserved = cfg.seqCounter + 64;
    reserve = cfg.seqReserved;
  }
  portEXIT_CRITICAL(&seqMux);
  if (reserve) {
    prefs.begin(NS, false);
    prefs.putUInt("seq_high", reserve);
    prefs.end();
  }
  return s;
}

uint32_t configPeekSeq() { return cfg.seqCounter; }

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
