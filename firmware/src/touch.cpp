#include "touch.h"
#include "pins.h"
#include "config.h"

static bool sEnabled = false;
static uint16_t sBaseline = 0;
static uint32_t sDownSince = 0;
static bool sFired = false;

void touchBegin() {
  uint32_t sum = 0;
  int n = 0;
  for (int i = 0; i < 32; i++) {
    uint16_t v = touchRead(PANIC_TOUCH_PIN);
    if (v > 0) { sum += v; n++; }
    delay(10);
  }
  if (n < 16 || sum / n < 20) {
    sEnabled = false;
    Serial.printf("[ERROR] panic touch unavailable on GPIO%d (baseline=%u)\n",
                  PANIC_TOUCH_PIN, n ? (unsigned)(sum / n) : 0u);
    return;
  }
  sBaseline = (uint16_t)(sum / n);
  cfg.panicBaseline = sBaseline;
  configSave();
  sEnabled = true;
  Serial.printf("[STATUS] panic touch calibrated GPIO%d baseline=%u threshold=%u hold=%ums\n",
                PANIC_TOUCH_PIN, sBaseline, (unsigned)(sBaseline * 0.72f), cfg.panicTouchMs);
}

bool touchTick(uint32_t now) {
  if (!sEnabled) return false;
  uint16_t v = touchRead(PANIC_TOUCH_PIN);
  bool down = v < (uint16_t)(sBaseline * 0.72f);

  if (!down) {
    if (sDownSince && now - sDownSince < 1000) {
      Serial.println("[STATUS] panic touch ignored (hold <1s)");
    }
    sDownSince = 0;
    sFired = false;
    return false;
  }
  if (!sDownSince) {
    sDownSince = now;
    return false;
  }
  if (!sFired && now - sDownSince >= cfg.panicTouchMs) {
    sFired = true;
    return true;
  }
  return false;
}

uint16_t touchBaseline() { return sBaseline; }
bool touchEnabled() { return sEnabled; }
