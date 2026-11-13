#pragma once
#include <Arduino.h>

void statusPageBegin();
void statusPageTick();
void statusPageEnd();
void statusPageSetLastCard(const String& uid, const String& role);
