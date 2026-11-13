#pragma once
#include <Arduino.h>

void sensorsBegin();
bool sensorsReadDht(float& tempC, float& rh);
bool sensorsReadFlame();

// Returns true once per physical card tap. UID is uppercase hex.
bool rfidPoll(String& uid);
bool rfidHealthy();
