#pragma once
#include <Arduino.h>

// Runtime configuration persisted in NVS. Nothing here is hard-coded at build
// time: Wi-Fi, room id, server URL, token, thresholds and RFID UIDs are all set
// via the provisioning page (or pushed from the backend) and stored in flash.
struct Config {
  String wifiSsid;
  String wifiPass;
  String roomId;
  String serverUrl;       // e.g. https://your-app.onrender.com (no trailing slash)
  String deviceToken;
  String deviceId;
  String setupPassword;   // 8-char WPA2 password for the setup AP
  String rootCa;          // optional PEM trust anchor override for HTTPS

  String studentUids;     // comma-separated hex UIDs
  String teacherUids;     // comma-separated hex UIDs

  // Level 3 status thresholds (backend settings keys in brackets).
  float tempThresholdC;       // temp_threshold_c      (WARNING entry)
  float humidityThresholdPct; // humidity_threshold_pct
  float dangerTempC;          // danger_temp_c         (DANGER entry)
  float dangerExitTempC;      // danger_exit_temp_c    (DANGER exit)
  float warnExitTempC;        // warn_exit_temp_c      (WARNING exit)
  float warnExitHumidityPct;  // warn_exit_humidity_pct

  uint32_t flameResponseLimitMs;  // flame_response_limit_ms / fire_confirm_ms
  uint32_t panicTouchMs;          // panic_touch_ms
  uint32_t doorAutoLockMs;        // door_auto_lock_ms
  uint32_t telemetryIntervalMs;   // telemetry_interval_ms
  uint32_t commandPollIntervalMs; // command_poll_interval_ms

  // Persistent state that must survive power loss.
  uint32_t seqCounter;    // next telemetry/event sequence number (RAM)
  uint32_t seqReserved;   // persisted upper bound, never re-used after reboot
  bool fireLatched;
  bool fireSilenced;
  uint16_t panicBaseline;
};

extern Config cfg;

void configLoad();
void configSave();
void configSaveWifi();
void configSaveFireState();
bool configHasWifi();
String configDefaultDeviceId();
String configTeamId();
String configApSsid();
String configMdnsHost();
String configEnsureSetupPassword();
void configClearWifi();
uint32_t configNextSeq();
uint32_t configPeekSeq();

// UID classification (case-insensitive, trimmed).
bool uidIsTeacher(const String& uid);
bool uidIsStudent(const String& uid);
String uidNormalize(const String& uid);
