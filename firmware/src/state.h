#pragma once
#include <Arduino.h>

enum StatusLevel : uint8_t { ST_SAFE = 0, ST_WARNING = 1, ST_DANGER = 2, ST_FIRE = 3 };
enum HeatTrend : uint8_t { TREND_UNKNOWN = 0, TREND_RISING = 1, TREND_STABLE = 2, TREND_FALLING = 3 };

#define STATE_CHG_NONE       0x00
#define STATE_CHG_STATUS     0x01
#define STATE_CHG_FIRE       0x02
#define STATE_CHG_FIRE_REARM 0x04

void stateBegin();
bool stateBootFlameCheck(bool flame);

// Called by the sensor task on every sample (100 ms). DHT fields only change
// when newDht is true. Returns STATE_CHG_* transition flags.
uint8_t stateSensorSample(float tempC, float rh, bool newDht, bool dhtReadOk, bool flame, uint32_t now);
void stateTick(uint32_t now);

void stateSetRfidFault(bool fault);
bool stateDhtFault();
bool stateRfidFault();
bool stateSensorFault();
bool stateQualityGood();

bool stateFireLatched();
bool stateFireSilenced();
bool stateSilenceFire();
bool stateClearFire();
bool stateFlameDetected();

bool statePanicActive();
void stateTriggerPanic(uint32_t now);

StatusLevel stateStatus();
const char* stateStatusStr();
const char* stateTelemetryStatusStr();  // FIRE > PANIC > ambient status
HeatTrend stateHeatTrend();
const char* stateTrendStr();
const char* stateQualityStr();

float stateTempC();
float stateRhPct();
float stateHeatIndexC();
float stateLastValidTempC();
float stateLastValidRhPct();
