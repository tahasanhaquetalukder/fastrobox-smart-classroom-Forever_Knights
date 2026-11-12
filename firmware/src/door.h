#pragma once
#include <Arduino.h>

enum DoorState { DOOR_LOCKED, DOOR_UNLOCKED };
enum LedMode { LED_LOCKED, LED_UNLOCKED, LED_ALERT, LED_PROVISIONING, LED_CONNECTING, LED_DENIED };

void doorBegin();
void doorTick();                       // call every loop: auto-lock, LED, buzzer
void doorLock();
void doorUnlock(uint32_t autoLockMs);  // autoLockMs=0 -> stay unlocked
void doorSetAlert(bool on);            // flame alert overrides LED + buzzer
void doorDeny();                       // denied-access beep + flash
DoorState doorGetState();
const char* doorStateStr();
void ledSet(LedMode mode);