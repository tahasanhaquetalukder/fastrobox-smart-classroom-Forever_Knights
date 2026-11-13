#pragma once
#include <Arduino.h>

// Runtime configuration persisted in NVS. NOTHING here is hard-coded at build
// time: Wi-Fi, room id, server URL, token, thresholds and RFID UIDs are all set
// via the provisioning page (or pushed from the backend) and stored in flash.
struct Config {
  String wifiSsid;
  String wifiPass;
  String roomId;
  String serverUrl;      // e.g. https://your-app.onrender.com (no trailing slash)
  String rootCa;         // PEM root CA used to validate the HTTPS server
  String deviceToken;
  String deviceId;
  float tempThresholdC;
  float humidityThresholdPct;
  uint32_t flameResponseLimitMs;
  uint32_t doorAutoLockMs;
  uint32_t telemetryIntervalMs;
  uint32_t commandPollIntervalMs;
  String studentUids;    // comma-separated hex UIDs
  String teacherUids;    // comma-separated hex UIDs
};

extern Config cfg;

void configLoad();
void configSave();
bool configHasWifi();
String configDefaultDeviceId();

// UID classification (case-insensitive, trimmed).
bool uidIsTeacher(const String& uid);
bool uidIsStudent(const String& uid);
String uidNormalize(const String& uid);