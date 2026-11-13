#include "alerts.h"
#include "pins.h"
#include "state.h"
#include <Adafruit_NeoPixel.h>

static Adafruit_NeoPixel strip(RGB_LED_COUNT, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);

static AlertMode sMode = ALERT_NONE;
static uint32_t sModeSince = 0;
static AlertMode sPulse = ALERT_NONE;
static uint32_t sPulseUntil = 0;
static bool sWifiOnline = false;
static bool sProvisioning = false;
static bool sCameraFault = false;
static bool sWeatherDanger = false;
static bool sLastOn = false;
static uint32_t sLastColor = 0xFFFFFFFF;

static uint32_t col(uint8_t r, uint8_t g, uint8_t b) { return strip.Color(r, g, b); }

static AlertMode computeMode(uint32_t now) {
  if (sProvisioning) return ALERT_WIFI_OFFLINE;
  if (stateFireLatched()) return ALERT_FIRE;
  if (statePanicActive()) return ALERT_PANIC;
  if (stateSensorFault()) return ALERT_SENSOR_ERROR;
  if (sCameraFault) return ALERT_CAMERA_FAULT;
  if (sWeatherDanger) return ALERT_WEATHER_DANGER;
  if (stateStatus() == ST_DANGER) return ALERT_HEAT_DANGER;
  if (stateStatus() == ST_WARNING) return ALERT_WARNING;
  if (sPulse != ALERT_NONE && (int32_t)(now - sPulseUntil) < 0) return sPulse;
  if (!sWifiOnline) return ALERT_WIFI_OFFLINE;
  return ALERT_SAFE;
}

static void ledFor(uint32_t now, bool& on, uint32_t& color) {
  uint32_t e = now - sModeSince;
  switch (sMode) {
    case ALERT_FIRE:
      color = col(180, 0, 0);
      if (stateFireSilenced()) { on = true; }
      else { on = (e % 200) < 100; }          // 5 Hz
      break;
    case ALERT_PANIC:
      on = true;
      color = ((e / 250) % 2) ? col(0, 0, 180) : col(180, 0, 0);
      break;
    case ALERT_HEAT_DANGER: {
      uint32_t p = e % 1000;                   // 2 Hz heartbeat (double pulse)
      on = (p < 100) || (p >= 200 && p < 300);
      color = col(180, 0, 0);
      break;
    }
    case ALERT_WARNING:
      on = (e % 500) < 250;
      color = col(180, 160, 0);
      break;
    case ALERT_SENSOR_ERROR:
      on = (e % 500) < 250;
      color = col(180, 0, 180);
      break;
    case ALERT_CAMERA_FAULT:
      on = (e % 500) < 250;
      color = col(0, 180, 180);
      break;
    case ALERT_WEATHER_DANGER:
      on = (e % 500) < 250;
      color = col(120, 0, 180);
      break;
    case ALERT_ACCESS_GRANTED:
      on = true;
      color = col(0, 180, 0);
      break;
    case ALERT_DENIED:
      on = e < 600 && ((e / 100) % 2 == 0);
      color = col(180, 0, 0);
      break;
    case ALERT_WIFI_OFFLINE:
      on = (e % 500) < 250;
      color = col(0, 0, 180);
      break;
    default:                                    // SAFE
      on = (e % 500) < 250;
      color = col(0, 180, 0);
      break;
  }
}

static bool buzzerFor(uint32_t now) {
  uint32_t e = now - sModeSince;
  switch (sMode) {
    case ALERT_FIRE:
      return !stateFireSilenced();              // continuous
    case ALERT_PANIC:
      return (e % 200) < 100;                   // 100 ms on/off
    case ALERT_WEATHER_DANGER:
      return e < 900 && ((e % 300) < 150);      // three beeps
    case ALERT_ACCESS_GRANTED:
      return e < 120;                           // one short beep
    case ALERT_DENIED:
      return (e < 100) || (e >= 200 && e < 300); // two short beeps
    default:
      return false;
  }
}

void alertsBegin() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  strip.begin();
  strip.setBrightness(40);
  strip.clear();
  strip.show();
  sMode = ALERT_NONE;
  sWifiOnline = false;
}

void alertsTick() {
  uint32_t now = millis();
  AlertMode want = computeMode(now);
  if (want != sMode) {
    sMode = want;
    sModeSince = now;
    sLastColor = 0xFFFFFFFF;
  }
  if (sPulse != ALERT_NONE && (int32_t)(now - sPulseUntil) >= 0) sPulse = ALERT_NONE;

  bool on = false;
  uint32_t color = 0;
  ledFor(now, on, color);
  if (on != sLastOn || (on && color != sLastColor)) {
    strip.setPixelColor(0, on ? color : 0);
    strip.show();
    sLastOn = on;
    sLastColor = color;
  }
  digitalWrite(BUZZER_PIN, buzzerFor(now) ? HIGH : LOW);
}

void alertsAccessGranted() {
  sPulse = ALERT_ACCESS_GRANTED;
  sPulseUntil = millis() + 5000;
}

void alertsDenied() {
  sPulse = ALERT_DENIED;
  sPulseUntil = millis() + 1500;
}

void alertsSetWifiOnline(bool online) { sWifiOnline = online; }
void alertsSetProvisioning(bool provisioning) { sProvisioning = provisioning; }
void alertsSetCameraFault(bool fault) { sCameraFault = fault; }
void alertsSetWeatherDanger(bool danger) { sWeatherDanger = danger; }

const char* alertsModeStr() {
  switch (sMode) {
    case ALERT_FIRE:           return "FIRE";
    case ALERT_PANIC:          return "PANIC";
    case ALERT_SENSOR_ERROR:   return "SENSOR_ERROR";
    case ALERT_CAMERA_FAULT:   return "CAMERA_FAULT";
    case ALERT_WEATHER_DANGER: return "WEATHER_DANGER";
    case ALERT_HEAT_DANGER:    return "HEAT_DANGER";
    case ALERT_WARNING:        return "WARNING";
    case ALERT_ACCESS_GRANTED: return "ACCESS_GRANTED";
    case ALERT_DENIED:         return "DENIED";
    case ALERT_WIFI_OFFLINE:   return "WIFI_OFFLINE";
    case ALERT_SAFE:           return "SAFE";
    default:                   return "NONE";
  }
}
