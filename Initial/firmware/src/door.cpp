#include "door.h"
#include "pins.h"
#include <Adafruit_NeoPixel.h>

static Adafruit_NeoPixel strip(RGB_LED_COUNT, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);
static DoorState state = DOOR_LOCKED;
static uint32_t autoLockAt = 0;
static bool alert = false;
static uint32_t denyUntil = 0;

// --- Non-blocking buzzer ---
enum BuzzMode { BUZZ_OFF, BUZZ_ONESHOT, BUZZ_ALARM };
static BuzzMode buzzMode = BUZZ_OFF;
static uint32_t buzzUntil = 0;
static uint32_t buzzToggleAt = 0;
static bool buzzLevel = false;

static void buzzerBeep(uint32_t ms) { buzzMode = BUZZ_ONESHOT; buzzUntil = millis() + ms; }
static void buzzerAlarm(bool on) {
  buzzMode = on ? BUZZ_ALARM : BUZZ_OFF;
  if (!on) { digitalWrite(BUZZER_PIN, LOW); buzzLevel = false; }
}
static void buzzerTick() {
  uint32_t now = millis();
  if (buzzMode == BUZZ_ONESHOT) {
    if (now < buzzUntil) digitalWrite(BUZZER_PIN, HIGH);
    else { digitalWrite(BUZZER_PIN, LOW); buzzMode = BUZZ_OFF; }
  } else if (buzzMode == BUZZ_ALARM) {
    if (now >= buzzToggleAt) { buzzLevel = !buzzLevel; digitalWrite(BUZZER_PIN, buzzLevel); buzzToggleAt = now + 200; }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void ledSet(LedMode mode) {
  uint32_t c;
  switch (mode) {
    case LED_LOCKED:       c = strip.Color(180, 0, 0); break;
    case LED_UNLOCKED:     c = strip.Color(0, 180, 0); break;
    case LED_ALERT:        c = strip.Color(180, 0, 0); break;
    case LED_PROVISIONING: c = strip.Color(0, 0, 180); break;
    case LED_CONNECTING:   c = strip.Color(180, 120, 0); break;
    case LED_DENIED:       c = strip.Color(180, 0, 0); break;
    default:               c = 0;
  }
  strip.setPixelColor(0, c);
  strip.show();
}

void doorBegin() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  strip.begin();
  strip.setBrightness(60);
  state = DOOR_LOCKED;
  ledSet(LED_LOCKED);
  Serial.println("[door] initialized LOCKED");
}

void doorLock() {
  state = DOOR_LOCKED;
  autoLockAt = 0;
  if (!alert) ledSet(LED_LOCKED);
  Serial.println("[door] LOCKED");
}

void doorUnlock(uint32_t autoLockMs) {
  state = DOOR_UNLOCKED;
  autoLockAt = autoLockMs > 0 ? millis() + autoLockMs : 0;
  if (!alert) ledSet(LED_UNLOCKED);
  buzzerBeep(120);
  Serial.println("[door] UNLOCKED");
}

void doorSetAlert(bool on) {
  if (on == alert) return;
  alert = on;
  if (on) { buzzerAlarm(true); Serial.println("[door] FLAME ALERT"); }
  else { buzzerAlarm(false); ledSet(state == DOOR_UNLOCKED ? LED_UNLOCKED : LED_LOCKED); Serial.println("[door] flame cleared"); }
}

void doorDeny() {
  denyUntil = millis() + 1500;
  buzzerBeep(1200);
  Serial.println("[door] access DENIED");
}

DoorState doorGetState() { return state; }
const char* doorStateStr() { return state == DOOR_UNLOCKED ? "UNLOCKED" : "LOCKED"; }

void doorTick() {
  uint32_t now = millis();
  if (state == DOOR_UNLOCKED && autoLockAt && (int32_t)(now - autoLockAt) >= 0) doorLock();

  static uint32_t flashAt = 0;
  static bool phase = false;
  static bool denyActive = false;

  if (alert) {
    if (now >= flashAt) {
      phase = !phase;
      strip.setPixelColor(0, phase ? strip.Color(180, 0, 0) : strip.Color(0, 0, 180));
      strip.show();
      flashAt = now + 250;
    }
    denyActive = false;
  } else if (now < denyUntil) {
    denyActive = true;
    if (now >= flashAt) {
      phase = !phase;
      strip.setPixelColor(0, phase ? strip.Color(180, 0, 0) : 0);
      strip.show();
      flashAt = now + 150;
    }
  } else if (denyActive) {
    denyActive = false;
    ledSet(state == DOOR_UNLOCKED ? LED_UNLOCKED : LED_LOCKED);
  }
  buzzerTick();
}