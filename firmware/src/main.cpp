#include <Arduino.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "pins.h"
#include "version.h"
#include "config.h"
#include "state.h"
#include "sensors.h"
#include "door.h"
#include "alerts.h"
#include "net.h"
#include "statuspage.h"
#include "provisioning.h"
#include "touch.h"
#include "sysinfo.h"
#include "heartbeat.h"

volatile uint32_t hbSensor = 0;
volatile uint32_t hbRfid = 0;
volatile uint32_t hbNet = 0;
volatile uint32_t hbWeb = 0;
volatile uint32_t hbAlert = 0;
volatile uint32_t hbSerial = 0;
volatile uint32_t hbTouch = 0;

static TaskHandle_t tSensor = nullptr;
static TaskHandle_t tRfid = nullptr;
static TaskHandle_t tNet = nullptr;
static TaskHandle_t tWeb = nullptr;
static TaskHandle_t tAlert = nullptr;
static TaskHandle_t tSerial = nullptr;
static TaskHandle_t tTouch = nullptr;

static void printHelp() {
  Serial.println("[CMD] commands: help | status | health | tasks | ver | hang | reset | seq | settings | wifi-reset");
  Serial.println("[CMD] serial tags: [STATUS] [CARD] [EVENT] [ERROR] [NET] [OTA] [CAM] [BLE] [CMD]");
  Serial.println("[CMD] [OTA]/[CAM]/[BLE] are reserved for later levels and are not used by this firmware.");
}

static void printStatus() {
  Serial.println("[CMD] ---- status ----");
  Serial.printf("[CMD] room=%s device=%s fw=%s\n", cfg.roomId.c_str(), cfg.deviceId.c_str(), FW_VERSION);
  Serial.printf("[CMD] temp=%.1fC rh=%.0f%% heat_index=%.1fC quality=%s trend=%s\n",
                stateTempC(), stateRhPct(), stateHeatIndexC(), stateQualityStr(), stateTrendStr());
  Serial.printf("[CMD] status=%s flame=%d door=%s fire_latched=%d fire_silenced=%d panic=%d\n",
                stateTelemetryStatusStr(), stateFlameDetected(), doorStateStr(),
                stateFireLatched(), stateFireSilenced(), statePanicActive());
  Serial.printf("[CMD] wifi=%d ip=%s rssi=%d backend=%d uptime=%lus\n",
                WiFi.status() == WL_CONNECTED, WiFi.localIP().toString().c_str(),
                WiFi.RSSI(), netBackendOnline(), (unsigned long)(millis() / 1000));
}

static void printHealth() {
  uint32_t now = millis();
  Serial.println("[CMD] ---- health ----");
  Serial.printf("[CMD] reset_reason=%s uptime=%lus heap=%uKB min_heap=%uKB chip_temp=%.1fC\n",
                sysResetReason(), (unsigned long)(now / 1000), sysHeapKb(),
                (unsigned)(ESP.getMinFreeHeap() / 1024), sysChipTempC());
  Serial.printf("[CMD] dht_fault=%d rfid_fault=%d dht_valid=%d quality=%s\n",
                stateDhtFault(), stateRfidFault(), stateQualityGood(), stateQualityStr());
  Serial.printf("[CMD] wifi=%d backend=%d spool=%u seq=%u\n",
                WiFi.status() == WL_CONNECTED, netBackendOnline(),
                (unsigned)netSpoolSize(), (unsigned)configPeekSeq());
  Serial.printf("[CMD] thresholds: warn=%.1fC/%.0f%% danger=%.1fC exit=%.1fC warn_exit=%.1fC/%.0f%%\n",
                cfg.tempThresholdC, cfg.humidityThresholdPct, cfg.dangerTempC,
                cfg.dangerExitTempC, cfg.warnExitTempC, cfg.warnExitHumidityPct);
}

static void printTasks() {
  struct Row { const char* name; TaskHandle_t h; volatile uint32_t* hb; };
  Row rows[] = {
    {"sensor", tSensor, &hbSensor},
    {"rfid", tRfid, &hbRfid},
    {"net", tNet, &hbNet},
    {"web", tWeb, &hbWeb},
    {"alert", tAlert, &hbAlert},
    {"serial", tSerial, &hbSerial},
    {"touch", tTouch, &hbTouch},
  };
  Serial.printf("[CMD] ---- tasks (%u total) ----\n", (unsigned)uxTaskGetNumberOfTasks());
  for (auto& r : rows) {
    uint32_t hb = r.hb ? *r.hb : 0;
    uint32_t stack = r.h ? (uint32_t)uxTaskGetStackHighWaterMark(r.h) : 0;
    Serial.printf("[CMD] %-7s stack_free=%u words heartbeat=%u\n", r.name, stack, hb);
  }
}

static void printVersion() {
  Serial.printf("[CMD] %s (%s) firmware %s built %s\n", PROJECT_NAME, TEAM_ID, FW_VERSION, FW_BUILD);
  Serial.printf("[CMD] chip=%s rev=%u mac=%04X%08X device=%s\n", sysChipModel(),
                (unsigned)ESP.getChipRevision(), (unsigned)(ESP.getEfuseMac() >> 32),
                (unsigned)ESP.getEfuseMac(), cfg.deviceId.c_str());
  Serial.printf("[CMD] setup_ap=%s (password is shown only while the setup AP is running)\n",
                configApSsid().c_str());
  Serial.printf("[CMD] mdns=http://%s.local/ server=%s\n", configMdnsHost().c_str(), cfg.serverUrl.c_str());
}

static void printSettings() {
  Serial.println("[CMD] ---- settings ----");
  Serial.printf("[CMD] room=%s server=%s device=%s\n", cfg.roomId.c_str(), cfg.serverUrl.c_str(), cfg.deviceId.c_str());
  Serial.printf("[CMD] warn_temp=%.1f warn_hum=%.1f danger=%.1f danger_exit=%.1f warn_exit_temp=%.1f warn_exit_hum=%.1f\n",
                cfg.tempThresholdC, cfg.humidityThresholdPct, cfg.dangerTempC,
                cfg.dangerExitTempC, cfg.warnExitTempC, cfg.warnExitHumidityPct);
  Serial.printf("[CMD] fire_confirm=%ums panic_hold=%ums autolock=%ums telemetry=%ums poll=%ums\n",
                cfg.flameResponseLimitMs, cfg.panicTouchMs, cfg.doorAutoLockMs,
                cfg.telemetryIntervalMs, cfg.commandPollIntervalMs);
  Serial.printf("[CMD] students=[%s]\n[CMD] teachers=[%s]\n", cfg.studentUids.c_str(), cfg.teacherUids.c_str());
  Serial.printf("[CMD] https_ca=%s\n", cfg.rootCa.length() ? "custom (NVS)" : "built-in trust anchor");
  Serial.println("[CMD] (Wi-Fi password and device token are intentionally not printed)");
}

static void handleCommand(String line) {
  line.trim();
  if (!line.length()) return;
  String cmd = line;
  cmd.toLowerCase();
  Serial.printf("[CMD] > %s\n", line.c_str());

  if (cmd == "help" || cmd == "?") { printHelp(); }
  else if (cmd == "status") { printStatus(); }
  else if (cmd == "health") { printHealth(); }
  else if (cmd == "tasks") { printTasks(); }
  else if (cmd == "ver" || cmd == "version") { printVersion(); }
  else if (cmd == "settings") { printSettings(); }
  else if (cmd == "seq") { Serial.printf("[CMD] last seq=%u\n", (unsigned)configPeekSeq()); }
  else if (cmd == "reset" || cmd == "reboot") {
    Serial.println("[CMD] reset requested");
    Serial.flush();
    delay(200);
    ESP.restart();
  } else if (cmd == "wifi-reset") {
    Serial.println("[NET] clearing Wi-Fi credentials; rebooting into setup AP");
    configClearWifi();
    Serial.flush();
    delay(300);
    ESP.restart();
  } else if (cmd == "hang") {
    Serial.println("[ERROR] deliberate hang requested; software watchdog will restart in <10 s");
    Serial.flush();
    while (true) { /* heartbeat is not fed on purpose */ }
  } else {
    Serial.printf("[ERROR] unknown command '%s' (try 'help')\n", line.c_str());
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
static void sensorTask(void*) {
  TickType_t last = xTaskGetTickCount();
  float dhtTemp = NAN;
  float dhtRh = NAN;
  uint32_t lastDhtAt = 0;
  bool prevDhtFault = false;
  bool prevRfidFault = false;

  for (;;) {
    hbSensor++;
    uint32_t now = millis();
    bool newDht = false;

    if (now - lastDhtAt >= 5000) {
      lastDhtAt = now;
      float t, h;
      if (sensorsReadDht(t, h)) {
        dhtTemp = t;
        dhtRh = h;
        newDht = true;
      }
    }

    bool flame = sensorsReadFlame();
    uint8_t changes = stateSensorSample(dhtTemp, dhtRh, newDht, newDht, flame, now);
    stateTick(now);
    doorTick();

    if (doorTakeChanged()) {
      JsonDocument p;
      p["state"] = doorStateStr();
      netQueueEvent("DOOR_CHANGE", doorStateStr(), p);
    }

    if (changes & STATE_CHG_FIRE) {
      JsonDocument p;
      p["temp_c"] = dhtTemp;
      p["rh"] = dhtRh;
      p["door"] = "UNLOCKED";
      netQueueEvent("FIRE", "Continuous flame detected", p);
      Serial.println("[STATUS] FIRE detected: door unlocked, buzzer continuous");
    }
    if (changes & STATE_CHG_FIRE_REARM) {
      Serial.println("[STATUS] fire alarm re-armed (flame returned while silenced)");
    }
    if ((changes & STATE_CHG_STATUS) && !(changes & STATE_CHG_FIRE)) {
      JsonDocument p;
      p["status"] = stateStatusStr();
      p["temp_c"] = dhtTemp;
      p["rh"] = dhtRh;
      p["quality"] = stateQualityStr();
      netQueueEvent("STATUS", stateStatusStr(), p);
      Serial.printf("[STATUS] status=%s temp=%.1fC rh=%.0f%%\n",
                    stateStatusStr(), dhtTemp, dhtRh);
    }

    bool dhtFault = stateDhtFault();
    if (dhtFault != prevDhtFault) {
      prevDhtFault = dhtFault;
      JsonDocument p;
      p["sensor"] = "DHT11";
      p["fault"] = dhtFault;
      netQueueEvent("SENSOR_ERROR", dhtFault ? "DHT11 read timeout" : "DHT11 recovered", p);
      if (dhtFault) Serial.println("[ERROR] DHT11 read timeout (>12s); status retained");
      else Serial.println("[STATUS] DHT11 recovered");
    }

    bool rfidFault = stateRfidFault();
    if (rfidFault != prevRfidFault) {
      prevRfidFault = rfidFault;
      JsonDocument p;
      p["sensor"] = "RC522";
      p["fault"] = rfidFault;
      netQueueEvent("SENSOR_ERROR", rfidFault ? "RC522 SPI fault" : "RC522 recovered", p);
      if (rfidFault) Serial.println("[ERROR] RC522 SPI fault (check 3.3V and SPI pins)");
      else Serial.println("[STATUS] RC522 recovered");
    }

    vTaskDelayUntil(&last, pdMS_TO_TICKS(100));
  }
}

static void rfidTask(void*) {
  for (;;) {
    hbRfid++;
    String uid;
    if (rfidPoll(uid)) {
      String card = uidNormalize(uid);
      bool teacher = uidIsTeacher(card);
      bool student = uidIsStudent(card);
      bool accepted = teacher || student;
      String role = teacher ? "teacher" : (student ? "student" : "unknown");

      statusPageSetLastCard(card, role);
      Serial.printf("[CARD] uid=%s role=%s accepted=%d fire=%d\n",
                    card.c_str(), role.c_str(), accepted, stateFireLatched());

      if (teacher && stateFireLatched()) {
        if (stateFlameDetected()) {
          Serial.println("[STATUS] teacher silence refused: flame still detected");
        } else if (stateSilenceFire()) {
          JsonDocument p;
          p["by"] = "teacher card";
          p["uid"] = card;
          netQueueEvent("SILENCED", "Fire alarm silenced by teacher card", p);
          Serial.println("[STATUS] fire alarm silenced by teacher card");
        }
      }

      if (!stateFireLatched()) {
        if (accepted) {
          doorUnlock(cfg.doorAutoLockMs);
          alertsAccessGranted();
        } else {
          alertsDenied();
        }
      }

      JsonDocument p;
      p["uid"] = card;
      p["role"] = role;
      p["accepted"] = accepted;
      p["fire_latched"] = stateFireLatched();
      netQueueEvent("CARD_TAP", accepted ? "Card accepted" : "Card denied", p);
    }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

static void netTask(void*) {
  for (;;) {
    hbNet++;
    netLoop();
  }
}

static void webTask(void*) {
  bool started = false;
  for (;;) {
    hbWeb++;
    if (!started && WiFi.status() == WL_CONNECTED) {
      statusPageBegin();
      started = true;
    }
    statusPageTick();
    delay(2);
  }
}

static void alertTask(void*) {
  for (;;) {
    hbAlert++;
    alertsTick();
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void serialTask(void*) {
  String line;
  uint32_t bootPressedAt = 0;
  bool bootActionDone = false;
  for (;;) {
    hbSerial++;
    while (Serial.available()) {
      char c = (char)Serial.read();
      if (c == '\n' || c == '\r') {
        if (line.length()) { handleCommand(line); line = ""; }
      } else if (line.length() < 100) {
        line += c;
      } else {
        line = "";
      }
    }

    if (digitalRead(BOOT_PIN) == LOW) {
      if (!bootPressedAt) bootPressedAt = millis();
      else if (!bootActionDone && millis() - bootPressedAt >= 5000) {
        bootActionDone = true;
        Serial.println("[NET] BOOT held 5 s: clearing Wi-Fi and restarting into setup AP");
        configClearWifi();
        Serial.flush();
        delay(300);
        ESP.restart();
      }
    } else {
      bootPressedAt = 0;
      bootActionDone = false;
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

static void touchTask(void*) {
  bool panicQueued = false;
  uint32_t clearAt = 0;
  for (;;) {
    hbTouch++;
    uint32_t now = millis();
    if (touchTick(now)) {
      stateTriggerPanic(now);
      JsonDocument p;
      p["active"] = true;
      p["baseline"] = touchBaseline();
      netQueueEvent("PANIC", "Panic touch triggered", p);
      Serial.println("[EVENT] PANIC touch triggered (10 s local alert)");
      panicQueued = true;
      clearAt = now + 10000;
    }
    if (panicQueued && (int32_t)(now - clearAt) >= 0) {
      panicQueued = false;
      JsonDocument p;
      p["active"] = false;
      netQueueEvent("PANIC", "Panic alert ended", p);
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

static void watchTask(void*) {
  struct Monitored { const char* name; volatile uint32_t* hb; uint32_t last; uint32_t changedAt; uint32_t limitMs; };
  Monitored mons[] = {
    {"sensor", &hbSensor, 0, 0, 9000},
    {"rfid", &hbRfid, 0, 0, 9000},
    {"net", &hbNet, 0, 0, 20000},
    {"web", &hbWeb, 0, 0, 9000},
    {"alert", &hbAlert, 0, 0, 9000},
    {"serial", &hbSerial, 0, 0, 8500},
    {"touch", &hbTouch, 0, 0, 9000},
  };
  uint32_t start = millis();
  for (auto& m : mons) { m.last = *m.hb; m.changedAt = start; }

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(250));
    uint32_t now = millis();
    for (auto& m : mons) {
      uint32_t v = *m.hb;
      if (v != m.last) { m.last = v; m.changedAt = now; continue; }
      if (now - m.changedAt > m.limitMs) {
        Serial.printf("[ERROR] watchdog: '%s' task stalled %lums; restarting\n",
                      m.name, (unsigned long)(now - m.changedAt));
        Serial.flush();
        delay(50);
        ESP.restart();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.printf("=== %s (%s) - firmware %s ===\n", PROJECT_NAME, TEAM_ID, FW_VERSION);
  Serial.printf("[STATUS] reset reason: %s | chip: %s rev %u | cores: %u\n",
                sysResetReason(), sysChipModel(), (unsigned)ESP.getChipRevision(), (unsigned)ESP.getChipCores());

  pinMode(BOOT_PIN, INPUT_PULLUP);
  configLoad();
  netBegin();       // LittleFS + offline spool + setup password
  stateBegin();
  alertsBegin();
  doorBegin();
  sensorsBegin();
  touchBegin();

  float t0 = NAN, h0 = NAN;
  bool dhtOk = sensorsReadDht(t0, h0);
  bool bootFlame = sensorsReadFlame();
  stateSensorSample(t0, h0, dhtOk, dhtOk, bootFlame, millis());
  bool latchedAtBoot = stateBootFlameCheck(bootFlame);
  if (latchedAtBoot) {
    doorUnlock(0);
    JsonDocument p;
    p["temp_c"] = t0;
    p["rh"] = h0;
    p["boot"] = true;
    netQueueEvent("FIRE", "Flame detected during startup check", p);
    Serial.println("[STATUS] startup flame check: FLAME -> door unlocked, fire latched");
  } else {
    Serial.println("[STATUS] startup flame check: clear -> door locked");
  }

  if (cfg.fireLatched) {
    Serial.println("[STATUS] persisted fire latch restored; door remains UNLOCKED until authorized reset");
  }

  if (provisioningNeeded()) {
    Serial.println("[NET] provisioning required (no Wi-Fi saved or BOOT held at reset)");
    alertsSetProvisioning(true);
    provisioningRun();  // never returns; reboots after save
  }

  Serial.println("[CMD] type 'help' on this console (115200 baud)");

  xTaskCreatePinnedToCore(sensorTask, "sensor", 4096, nullptr, 3, &tSensor, 1);
  xTaskCreatePinnedToCore(rfidTask, "rfid", 4096, nullptr, 2, &tRfid, 0);
  xTaskCreatePinnedToCore(netTask, "net", 8192, nullptr, 2, &tNet, 0);
  xTaskCreatePinnedToCore(webTask, "web", 6144, nullptr, 1, &tWeb, 0);
  xTaskCreatePinnedToCore(alertTask, "alert", 3072, nullptr, 4, &tAlert, 1);
  xTaskCreatePinnedToCore(serialTask, "serial", 4096, nullptr, 2, &tSerial, 1);
  xTaskCreatePinnedToCore(touchTask, "touch", 3072, nullptr, 2, &tTouch, 1);
  xTaskCreatePinnedToCore(watchTask, "watch", 3072, nullptr, 5, nullptr, 1);

  Serial.println("[STATUS] tasks started (dual-core FreeRTOS)");
}

void loop() {
  // All work runs in the FreeRTOS tasks; the loop task only yields.
  delay(1000);
}
