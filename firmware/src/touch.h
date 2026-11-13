#pragma once
#include <Arduino.h>

void touchBegin();
bool touchTick(uint32_t now);   // true once when a valid panic hold is detected
uint16_t touchBaseline();
bool touchEnabled();
