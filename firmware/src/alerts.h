#pragma once
#include <Arduino.h>

// Priority (highest first):
//   FIRE > PANIC > SENSOR ERROR > CAMERA FAULT > WEATHER DANGER >
//   HEAT DANGER > WARNING > ACCESS GRANTED > DENIED > WIFI OFFLINE > SAFE
enum AlertMode : uint8_t {
  ALERT_NONE = 0,
  ALERT_SAFE,
  ALERT_WARNING,
  ALERT_HEAT_DANGER,
  ALERT_FIRE,
  ALERT_PANIC,
  ALERT_ACCESS_GRANTED,
  ALERT_DENIED,
  ALERT_SENSOR_ERROR,
  ALERT_CAMERA_FAULT,
  ALERT_WEATHER_DANGER,
  ALERT_WIFI_OFFLINE,
};

void alertsBegin();
void alertsTick();

void alertsAccessGranted();
void alertsDenied();
void alertsSetWifiOnline(bool online);
void alertsSetProvisioning(bool provisioning);
void alertsSetCameraFault(bool fault);
void alertsSetWeatherDanger(bool danger);
const char* alertsModeStr();
