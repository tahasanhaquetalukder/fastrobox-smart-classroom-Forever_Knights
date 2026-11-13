#pragma once
#include <Arduino.h>

struct SensorData {
  float temperature;
  float humidity;
  bool flame;
  bool valid;
};

void sensorsBegin();
SensorData sensorsRead();
// Returns true when a NEW card is read (debounced); uid is uppercase hex.
bool rfidPoll(String& uid);