#pragma once
#include <Arduino.h>

// True only when BOOT is deliberately held at reset.
bool provisioningNeeded();
// Blocking: starts AP + captive web page, saves to NVS, reboots on submit.
void provisioningRun();