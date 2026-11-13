#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include <esp_system.h>

// ===================== PIN DEFINITIONS =====================
#define PIN_DHT         1
#define PIN_FLAME       2     // Active LOW on standard 3-pin IR flame module
#define PIN_BUZZER      39
#define PIN_RGB_LED     48    // Change to 38 if your S3-CAM clone uses GPIO 38

#define PIN_RFID_SS     21
#define PIN_RFID_RST    40
#define PIN_RFID_SCK    47
#define PIN_RFID_MOSI   41
#define PIN_RFID_MISO   42

// ===================== CONSTANTS & GLOBALS =====================
#define FW_VERSION      "1.0.0"
#define WDT_TIMEOUT_S   5     // Restarts in ~5s (strictly within the 10s limit)
#define DHTTYPE         DHT11

DHT dht(PIN_DHT, DHTTYPE);
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);

SemaphoreHandle_t serialMutex;

// Shared System State
volatile float g_tempC = NAN;
volatile float g_rh = NAN;
volatile bool  g_flame = false;
volatile bool  g_doorUnlocked = false;
volatile bool  g_dhtError = false;
volatile bool  g_rfidError = false;
volatile bool  g_triggerHang = false;

// Task Handles for 'tasks' command
TaskHandle_t hTaskFlameLED = NULL;
TaskHandle_t hTaskRFID     = NULL;
TaskHandle_t hTaskDHT      = NULL;
TaskHandle_t hTaskSerial   = NULL;

// Thread-safe Serial printf
void safePrintf(const char* format, ...) {
  char buf[256];
  va_list args;
  va_start(args, format);
  vsnprintf(buf, sizeof(buf), format, args);
  va_end(args);
  if (xSemaphoreTake(serialMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    Serial.print(buf);
    xSemaphoreGive(serialMutex);
  }
}

// Reset Reason Mapper (Strictly matches Level 1 specification)
const char* getResetReasonStr(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:   return "POWER_ON";
    case ESP_RST_SW:        return "SOFTWARE";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:       return "WATCHDOG";
    case ESP_RST_PANIC:     return "CRASH";
    case ESP_RST_BROWNOUT:  return "BROWNOUT";
    default:                return "POWER_ON";
  }
}

// Print the exact Level 1 [STATUS] line
void printStatusLine() {
  uint32_t up = millis() / 1000;
  char tStr[12], rhStr[12];

  if (isnan(g_tempC) || g_dhtError) snprintf(tStr, sizeof(tStr), "-");
  else snprintf(tStr, sizeof(tStr), "%.1fC", g_tempC);

  if (isnan(g_rh) || g_dhtError) snprintf(rhStr, sizeof(rhStr), "-");
  else snprintf(rhStr, sizeof(rhStr), "%.0f%%", g_rh);

  uint32_t heapKb  = ESP.getFreeHeap() / 1024;
  uint32_t psramKb = ESP.getFreePsram() / 1024;
  float chipTemp   = temperatureRead();

  safePrintf("[STATUS] up=%lus T=%s RH=%s HI=- flame=%d door=%s state SAFE trend - rssi=- heap=%luk psram=%luk chip=%.1fC fw=%s\n",
           up, tStr, rhStr, g_flame ? 1 : 0,
           g_doorUnlocked ? "UNLOCKED" : "LOCKED",
           heapKb, psramKb, chipTemp, FW_VERSION);
}

// ===================== TASK 1: FLAME (100ms) & RGB LED (2Hz) [Core 0] =====================
void TaskFlameAndLED(void *pvParameters) {
  esp_task_wdt_add(NULL);
  TickType_t xLastWakeTime = xTaskGetTickCount();
  uint32_t tick50ms = 0;
  bool ledOn = false;

  for (;;) {
    esp_task_wdt_reset();

    // 1. Read Flame Sensor every 100 ms (every 2 ticks of 50ms)
    if (tick50ms % 2 == 0) {
      g_flame = (digitalRead(PIN_FLAME) == LOW);
    }

    // 2. Blink RGB LED at 2 Hz (250 ms ON, 250 ms OFF -> every 5 ticks of 50ms)
    if (tick50ms % 5 == 0) {
      ledOn = !ledOn;
      if (ledOn) {
        // Priority 6: Sensor Error -> Magenta; Priority 11: Safe -> Green
        if (g_dhtError || g_rfidError) {
          neopixelWrite(PIN_RGB_LED, 64, 0, 64); // Magenta
        } else {
          neopixelWrite(PIN_RGB_LED, 0, 64, 0);  // Green
        }
      } else {
        neopixelWrite(PIN_RGB_LED, 0, 0, 0);    // OFF
      }
    }

    tick50ms++;
    vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(50));
  }
}

// ===================== TASK 2: RFID READER (200ms) [Core 1] =====================
void TaskRFID(void *pvParameters) {
  esp_task_wdt_add(NULL);
  TickType_t xLastWakeTime = xTaskGetTickCount();

  bool cardPresent = false;
  uint8_t missCount = 0;
  uint8_t failCount = 0;

  for (;;) {
    esp_task_wdt_reset();

    // Check RC522 hardware connectivity via VersionReg (0x37)
    byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
    bool commOk = (v == 0x91 || v == 0x92 || v == 0x90 || v == 0x88 || v == 0x12);

    if (!commOk) {
      failCount++;
      // 5 consecutive fails * 200ms = 1.0s (Strictly within 3s requirement)
      if (failCount >= 5 && !g_rfidError) {
        g_rfidError = true;
        safePrintf("[ERROR] SENSOR ERROR: RFID\n");
      }
    } else {
      if (g_rfidError) {
        rfid.PCD_Init(); // Re-initialize RC522 when wire is plugged back in
        g_rfidError = false;
      }
      failCount = 0;

      // Single-tap detection logic (reports once even if card is held down)
      byte atqa[2];
      byte atqaSize = sizeof(atqa);
      MFRC522::StatusCode status = rfid.PICC_WakeupA(atqa, &atqaSize);

      if (status == MFRC522::STATUS_OK || status == MFRC522::STATUS_COLLISION) {
        if (rfid.PICC_ReadCardSerial()) {
          if (!cardPresent) {
            cardPresent = true;
            char uidStr[32] = "";
            for (byte i = 0; i < rfid.uid.size; i++) {
              char hex[4];
              snprintf(hex, sizeof(hex), "%02X", rfid.uid.uidByte[i]);
              strcat(uidStr, hex);
            }
            safePrintf("[CARD] uid=%s\n", uidStr);
          }
          missCount = 0;
          rfid.PICC_HaltA();
        }
      } else {
        // Require 2 consecutive misses (400ms) before arming for next tap
        missCount++;
        if (missCount >= 2) {
          cardPresent = false;
        }
      }
    }

    vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(200));
  }
}

// ===================== TASK 3: DHT11 SENSOR (5000ms) [Core 1] =====================
void TaskDHT(void *pvParameters) {
  esp_task_wdt_add(NULL);
  TickType_t xLastWakeTime = xTaskGetTickCount();
  uint32_t lastReadMs = 0;
  uint32_t lastValidMs = millis();

  for (;;) {
    esp_task_wdt_reset();
    uint32_t now = millis();

    // Poll every 5000ms normally, or every 2000ms while in error state for fast recovery
    uint32_t interval = g_dhtError ? 2000 : 5000;

    if (now - lastReadMs >= interval || lastReadMs == 0) {
      lastReadMs = now;
      float t = dht.readTemperature();
      float h = dht.readHumidity();

      if (isnan(t) || isnan(h)) {
        // Trigger error within ~10s of unplugging (strictly within 12s limit)
        if (!g_dhtError && (now - lastValidMs >= 9500)) {
          g_dhtError = true;
          safePrintf("[ERROR] SENSOR ERROR: DHT11\n");
        }
      } else {
        g_tempC = t;
        g_rh = h;
        lastValidMs = now;
        if (g_dhtError) {
          g_dhtError = false; // Auto-clears on reconnect
        }
      }
    }

    vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(200));
  }
}

// ===================== TASK 4: SERIAL CLI & 1Hz STATUS [Core 1] =====================
void handleSerialCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd == "help") {
    safePrintf("[CMD] Commands: help, status, health, tasks, ver, hang\n");
  } 
  else if (cmd == "status") {
    safePrintf("[CMD] ");
    printStatusLine();
  } 
  else if (cmd == "health") {
    safePrintf("[CMD] chip=%.1fC heap=%luB psram=%luB flash=%luB cpu=%luMHz rssi=N/A up=%lus reset=%s fw=%s\n",
               temperatureRead(),
               (unsigned long)ESP.getFreeHeap(),
               (unsigned long)ESP.getFreePsram(),
               (unsigned long)ESP.getFlashChipSize(),
               (unsigned long)ESP.getCpuFreqMHz(),
               millis() / 1000,
               getResetReasonStr(esp_reset_reason()),
               FW_VERSION);
  } 
  else if (cmd == "tasks") {
    safePrintf("[CMD] TaskFlameLED(Core=%d,StackFree=%uB) TaskRFID(Core=%d,StackFree=%uB) TaskDHT(Core=%d,StackFree=%uB) TaskSerial(Core=%d,StackFree=%uB)\n",
               xTaskGetCoreID(hTaskFlameLED), uxTaskGetStackHighWaterMark(hTaskFlameLED),
               xTaskGetCoreID(hTaskRFID),     uxTaskGetStackHighWaterMark(hTaskRFID),
               xTaskGetCoreID(hTaskDHT),      uxTaskGetStackHighWaterMark(hTaskDHT),
               xTaskGetCoreID(hTaskSerial),   uxTaskGetStackHighWaterMark(hTaskSerial));
  } 
  else if (cmd == "ver") {
    safePrintf("[CMD] fw=%s build=%s %s\n", FW_VERSION, __DATE__, __TIME__);
  } 
  else if (cmd == "hang") {
    safePrintf("[CMD] Freezing TaskSerial to trigger hardware watchdog...\n");
    g_triggerHang = true;
  } 
  else {
    safePrintf("[CMD] Unknown command: %s\n", cmd.c_str());
  }
}

void TaskSerialAndStatus(void *pvParameters) {
  esp_task_wdt_add(NULL);
  TickType_t xLastWakeTime = xTaskGetTickCount();
  uint32_t lastStatusMs = 0;
  String inputBuf = "";

  for (;;) {
    if (g_triggerHang) {
      // Deliberate infinite loop without resetting WDT -> triggers reboot within 5s
      while (true) { ; }
    }

    esp_task_wdt_reset();

    while (Serial.available()) {
      char c = (char)Serial.read();
      if (c == '\n' || c == '\r') {
        if (inputBuf.length() > 0) {
          handleSerialCommand(inputBuf);
          inputBuf = "";
        }
      } else {
        inputBuf += c;
      }
    }

    uint32_t now = millis();
    if (now - lastStatusMs >= 1000) {
      lastStatusMs = now;
      printStatusLine();
    }

    vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(50));
  }
}

// ===================== SETUP & LOOP =====================
void setup() {
  Serial.begin(115200);
  delay(300); // Brief settle time for USB-CDC Serial

  serialMutex = xSemaphoreCreateMutex();

  // Task 6: Check flame sensor FIRST at start-up
  pinMode(PIN_FLAME, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  g_flame = (digitalRead(PIN_FLAME) == LOW);
  g_doorUnlocked = g_flame; // No flame -> LOCKED (false); Flame -> UNLOCKED (true)

  // Task 5: Report boot reason immediately at start-up
  esp_reset_reason_t reason = esp_reset_reason();
  safePrintf("[EVENT] BOOT reason=%s\n", getResetReasonStr(reason));

  // Initialize Sensors
  dht.begin();
  SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
  rfid.PCD_Init();

  // Configure Hardware Task Watchdog (5s timeout, panic/reboot enabled)
  #if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
    esp_task_wdt_config_t twdt_config = {
      .timeout_ms = WDT_TIMEOUT_S * 1000,
      .idle_core_mask = 0,
      .trigger_panic = true
    };
    if (esp_task_wdt_reconfigure(&twdt_config) != ESP_OK) {
      esp_task_wdt_init(&twdt_config);
    }
  #else
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
  #endif

  // Create Dual-Core FreeRTOS Tasks
  xTaskCreatePinnedToCore(TaskFlameAndLED,     "FlameLED", 4096, NULL, 2, &hTaskFlameLED, 0);
  xTaskCreatePinnedToCore(TaskRFID,            "RFID",     4096, NULL, 2, &hTaskRFID,     1);
  xTaskCreatePinnedToCore(TaskDHT,             "DHT",      4096, NULL, 1, &hTaskDHT,      1);
  xTaskCreatePinnedToCore(TaskSerialAndStatus, "Serial",   6144, NULL, 1, &hTaskSerial,   1);
}

void loop() {
  vTaskDelete(NULL); // Remove Arduino loopTask; all work runs in FreeRTOS tasks
}
