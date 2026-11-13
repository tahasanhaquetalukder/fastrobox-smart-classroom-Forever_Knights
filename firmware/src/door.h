#pragma once
#include <Arduino.h>

enum DoorState : uint8_t { DOOR_LOCKED = 0, DOOR_UNLOCKED = 1 };

void doorBegin();
void doorTick();                       // auto-lock + fire-latch override
void doorLock();                       // ignored while fire is latched
bool doorUnlock(uint32_t autoLockMs);  // autoLockMs=0 -> stay unlocked
bool doorTakeChanged();                // true once after any state change
DoorState doorGetState();
const char* doorStateStr();
