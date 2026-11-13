#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include "pins.h"
#include "config.h"
#include "sensors.h"
#include "door.h"
#include "net.h"
#include "statuspage.h"
#include "provisioning.h"

static SensorData latest;
static uint32_t lastSensorRead = 0;
static bool prevFlame = false;
static DoorState prevDoor = DOOR_LOCKED;

static void connectWifi() {
  ledSet(LED_CONNECTING);
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.wifiSsid.c_str(), cfg.wifiPass.c_str());
  Serial.printf("[wifi] connecting to '%s'\n", cfg.wifiSsid.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print(".");
    doorTick();
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[wifi] connected: " + WiFi.localIP().toString());
    ledSet(doorGetState() == DOOR_UNLOCKED ? LED_UNLOCKED : LED_LOCKED);
  } else {
    Serial.println("[wifi] failed; will retry in loop");
  }
}

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("\n=== AI-Powered Smart Classroom (Phase 1) ===");
  pinMode(BOOT_PIN, INPUT_PULLUP);
  configLoad();
  doorBegin();
  sensorsBegin();

  if (provisioningNeeded()) {
    Serial.println("[boot] provisioning authorized by BOOT hold");
    provisioningRun();  // blocks; reboots on save
  }

  connectWifi();
  netBegin();
  statusPageBegin();

  JsonDocument p;
  p["ip"] = WiFi.localIP().toString();
  p["room"] = cfg.roomId;
  netSendEvent("boot", p);
  Serial.println("[boot] ready");
}

void loop() {
  doorTick();
  statusPageTick();

  // Read sensors ~every 2s (DHT11 needs >=1s between reads).
  if (millis() - lastSensorRead >= 2000) {
    lastSensorRead = millis();
    latest = sensorsRead();
    statusPageUpdate(latest.temperature, latest.humidity, latest.flame);
    doorSetAlert(latest.flame);
    Serial.printf("[sensor] T=%.1fC H=%.0f%% flame=%d door=%s\n",
                  latest.temperature, latest.humidity, latest.flame, doorStateStr());
  }

  // Flame edge -> event.
  if (latest.flame != prevFlame) {
    prevFlame = latest.flame;
    JsonDocument p;
    p["active"] = latest.flame;
    netSendEvent("flame_alert", p);
  }

  // RFID access.
  String uid;
  if (rfidPoll(uid)) {
    bool teacher = uidIsTeacher(uid);
    bool student = uidIsStudent(uid);
    bool accepted = teacher || student;
    String role = teacher ? "teacher" : (student ? "student" : "unknown");
    String desc = uid + " (" + role + (accepted ? ", accepted)" : ", denied)");
    statusPageSetLastRfid(desc);
    Serial.println("[rfid] " + desc);
    if (accepted) doorUnlock(cfg.doorAutoLockMs);
    else doorDeny();
    JsonDocument p;
    p["uid"] = uid;
    p["role"] = role;
    p["accepted"] = accepted;
    netSendEvent("rfid_scan", p);
  }

  // Door state edge -> event (covers RFID, auto-lock and remote commands).
  if (doorGetState() != prevDoor) {
    prevDoor = doorGetState();
    JsonDocument d;
    d["state"] = doorStateStr();
    netSendEvent("door_change", d);
    Serial.printf("[door] state -> %s\n", doorStateStr());
  }

  // Telemetry, command polling, offline flush, settings sync.
  netTick(latest.temperature, latest.humidity, latest.flame);

  // Wi-Fi watchdog.
  static uint32_t lastWifiCheck = 0;
  if (millis() - lastWifiCheck >= 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[wifi] reconnecting");
      WiFi.reconnect();
    }
  }
}