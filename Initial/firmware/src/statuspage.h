#pragma once
#include <Arduino.h>

void statusPageBegin();
void statusPageTick();
void statusPageUpdate(float t, float h, bool flame);
void statusPageSetLastRfid(const String& s);