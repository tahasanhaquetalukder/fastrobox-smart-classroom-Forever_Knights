#pragma once
#include <Arduino.h>

// Cooperative heartbeats monitored by the software watchdog task. A stalled
// task (including a deliberate `hang` serial command) triggers a restart in
// under 10 seconds.
extern volatile uint32_t hbSensor;
extern volatile uint32_t hbRfid;
extern volatile uint32_t hbNet;
extern volatile uint32_t hbWeb;
extern volatile uint32_t hbAlert;
extern volatile uint32_t hbSerial;
extern volatile uint32_t hbTouch;
