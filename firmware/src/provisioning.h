#pragma once
#include <Arduino.h>

// True on first boot (no Wi-Fi saved) or when BOOT is held at reset.
bool provisioningNeeded();
// Blocking: starts AP + captive web page, saves to NVS, reboots on submit.
void provisioningRun();