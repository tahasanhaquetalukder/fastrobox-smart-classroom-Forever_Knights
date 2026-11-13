#include "state.h"
#include "config.h"
#include <math.h>

static const uint32_t DHT_FAULT_MS = 12000;   // DHT11 fault must be visible within 12 s
static const uint32_t STATUS_STABLE_MS = 3000;
static const uint8_t TREND_N = 10;

static float sTemp = NAN;
static float sRh = NAN;
static float sLastValidTemp = NAN;
static float sLastValidRh = NAN;
static float sHeatIndex = NAN;
static uint32_t sLastDhtOk = 0;
static uint32_t sLastValidAt = 0;
static bool sDhtResponded = false;
static bool sLastReadInRange = false;
static bool sHaveValid = false;
static bool sRfidFault = false;

static bool sFlame = false;
static uint32_t sFlameSince = 0;
static bool sFire = false;
static bool sSilenced = false;

static StatusLevel sStatus = ST_SAFE;
static StatusLevel sCandidate = ST_SAFE;
static uint32_t sCandidateSince = 0;

static HeatTrend sTrend = TREND_UNKNOWN;
static float sTrendBuf[TREND_N];
static uint8_t sTrendCount = 0;
static uint8_t sTrendIdx = 0;

static bool sPanic = false;
static uint32_t sPanicUntil = 0;

static float heatIndexC(float tC, float rh) {
  if (isnan(tC) || isnan(rh)) return NAN;
  float t = tC * 9.0f / 5.0f + 32.0f;
  float f = 0.5f * (t + 61.0f + ((t - 68.0f) * 1.2f) + rh * 0.094f);
  float hi;
  if ((f + t) / 2.0f >= 80.0f) {
    hi = -42.379f + 2.04901523f * t + 10.14333127f * rh
       - 0.22475541f * t * rh - 0.00683783f * t * t
       - 0.05481717f * rh * rh + 0.00122874f * t * t * rh
       + 0.00085282f * t * rh * rh - 0.00000199f * t * t * rh * rh;
    if (rh < 13 && t >= 80 && t <= 112) {
      hi -= ((13 - rh) / 4) * sqrtf((17 - fabsf(t - 95)) / 17);
    } else if (rh > 85 && t >= 80 && t <= 87) {
      hi += ((rh - 85) / 10) * ((87 - t) / 5);
    }
  } else {
    hi = f;
  }
  return ((hi - 32) * 5.0f / 9.0f);
}

static void pushTrend(float value) {
  sTrendBuf[sTrendIdx] = value;
  sTrendIdx = (sTrendIdx + 1) % TREND_N;
  if (sTrendCount < TREND_N) sTrendCount++;
  if (sTrendCount < 3) { sTrend = TREND_UNKNOWN; return; }
  uint8_t newest = (sTrendIdx + TREND_N - 1) % TREND_N;
  uint8_t oldest = (sTrendIdx + TREND_N - sTrendCount) % TREND_N;
  float delta = sTrendBuf[newest] - sTrendBuf[oldest];
  if (delta > 0.3f) sTrend = TREND_RISING;
  else if (delta < -0.3f) sTrend = TREND_FALLING;
  else sTrend = TREND_STABLE;
}

static bool inRange(float t, float rh) {
  return !isnan(t) && !isnan(rh) && t >= 0.0f && t <= 50.0f && rh >= 20.0f && rh <= 90.0f;
}

static bool qualityNow() {
  uint32_t now = millis();
  return sHaveValid && sLastReadInRange && sDhtResponded
      && (now - sLastDhtOk <= DHT_FAULT_MS)
      && (now - sLastValidAt <= DHT_FAULT_MS);
}

// Works with the current status to add hysteresis (Level 3 rules).
static StatusLevel targetStatus(float t, float rh) {
  if (sStatus == ST_DANGER) {
    if (t > cfg.dangerExitTempC) return ST_DANGER;
  } else if (sStatus == ST_WARNING) {
    if (t >= cfg.dangerTempC) return ST_DANGER;
    if (t <= cfg.warnExitTempC && rh <= cfg.warnExitHumidityPct) return ST_SAFE;
    return ST_WARNING;
  }
  if (t >= cfg.dangerTempC) return ST_DANGER;
  if (t >= cfg.tempThresholdC || rh >= cfg.humidityThresholdPct) return ST_WARNING;
  return ST_SAFE;
}

static StatusLevel quickTarget(float t, float rh) {
  if (t >= cfg.dangerTempC) return ST_DANGER;
  if (t >= cfg.tempThresholdC || rh >= cfg.humidityThresholdPct) return ST_WARNING;
  return ST_SAFE;
}

void stateBegin() {
  sLastDhtOk = millis();
  sCandidateSince = millis();
  sFire = cfg.fireLatched;
  sSilenced = cfg.fireSilenced && sFire;
  sStatus = sFire ? ST_FIRE : ST_SAFE;
  sCandidate = sStatus;
}

bool stateBootFlameCheck(bool flame) {
  sFlame = flame;
  if (!flame) return false;
  sFlameSince = millis() - cfg.flameResponseLimitMs;
  sFire = true;
  cfg.fireLatched = true;
  cfg.fireSilenced = false;
  configSaveFireState();
  sSilenced = false;
  sStatus = ST_FIRE;
  sCandidate = ST_FIRE;
  return true;
}

uint8_t stateSensorSample(float tempC, float rh, bool newDht, bool dhtReadOk, bool flame, uint32_t now) {
  uint8_t changes = STATE_CHG_NONE;

  if (newDht) {
    if (dhtReadOk && !isnan(tempC) && !isnan(rh)) {
      sDhtResponded = true;
      sLastDhtOk = now;
      sTemp = tempC;
      sRh = rh;
      bool ok = inRange(tempC, rh);
      sLastReadInRange = ok;
      if (ok) {
        sHaveValid = true;
        sLastValidAt = now;
        sLastValidTemp = tempC;
        sLastValidRh = rh;
        sHeatIndex = heatIndexC(tempC, rh);
        pushTrend(tempC);
      }
    }
  }

  // Fire detection: continuous flame for the configured confirmation window.
  if (flame && !sFlame) sFlameSince = now;
  if (!flame) sFlameSince = 0;

  if (sFire && flame && sSilenced) {
    sSilenced = false;
    cfg.fireSilenced = false;
    configSaveFireState();
    changes |= STATE_CHG_FIRE_REARM;
  }

  if (!sFire && flame && sFlameSince && (now - sFlameSince >= cfg.flameResponseLimitMs)) {
    sFire = true;
    cfg.fireLatched = true;
    configSaveFireState();
    changes |= STATE_CHG_FIRE;
  }
  sFlame = flame;

  if (sFire) {
    if (!sSilenced) {
      // Nothing else to do here; the alert task renders FIRE.
    }
    if (sStatus != ST_FIRE) {
      sStatus = ST_FIRE;
      sCandidate = ST_FIRE;
      sCandidateSince = now;
      changes |= STATE_CHG_STATUS;
    }
    return changes;
  }

  if (!qualityNow()) return changes;

  StatusLevel target = targetStatus(sLastValidTemp, sLastValidRh);
  if (target == sStatus) {
    sCandidate = sStatus;
    sCandidateSince = now;
  } else if (target != sCandidate) {
    sCandidate = target;
    sCandidateSince = now;
  } else if (now - sCandidateSince >= STATUS_STABLE_MS) {
    sStatus = target;
    changes |= STATE_CHG_STATUS;
  }
  return changes;
}

void stateTick(uint32_t now) {
  if (sPanic && (int32_t)(now - sPanicUntil) >= 0) sPanic = false;
}

void stateSetRfidFault(bool fault) { sRfidFault = fault; }

bool stateDhtFault() { return millis() - sLastDhtOk > DHT_FAULT_MS; }

bool stateRfidFault() { return sRfidFault; }
bool stateSensorFault() { return stateDhtFault() || sRfidFault; }

bool stateQualityGood() { return qualityNow(); }

bool stateFireLatched() { return sFire; }
bool stateFireSilenced() { return sFire && sSilenced; }
bool stateFlameDetected() { return sFlame; }

bool stateSilenceFire() {
  if (!sFire || sFlame) return false;
  sSilenced = true;
  cfg.fireSilenced = true;
  configSaveFireState();
  return true;
}

bool stateClearFire() {
  if (!sFire) return false;
  sFire = false;
  sSilenced = false;
  cfg.fireLatched = false;
  cfg.fireSilenced = false;
  configSaveFireState();
  sStatus = qualityNow() ? quickTarget(sLastValidTemp, sLastValidRh) : ST_WARNING;
  sCandidate = sStatus;
  sCandidateSince = millis();
  return true;
}

bool statePanicActive() { return sPanic; }

void stateTriggerPanic(uint32_t now) {
  sPanic = true;
  sPanicUntil = now + 10000;
}

StatusLevel stateStatus() { return sStatus; }

const char* stateStatusStr() {
  switch (sStatus) {
    case ST_WARNING: return "WARNING";
    case ST_DANGER:  return "DANGER";
    case ST_FIRE:    return "FIRE";
    default:         return "SAFE";
  }
}

const char* stateTelemetryStatusStr() {
  if (sFire) return "FIRE";
  if (sPanic) return "PANIC";
  return stateStatusStr();
}

HeatTrend stateHeatTrend() { return sTrend; }

const char* stateTrendStr() {
  switch (sTrend) {
    case TREND_RISING:  return "RISING";
    case TREND_STABLE:  return "STABLE";
    case TREND_FALLING: return "FALLING";
    default:            return "UNKNOWN";
  }
}

const char* stateQualityStr() { return qualityNow() ? "good" : "bad"; }

float stateTempC() { return sTemp; }
float stateRhPct() { return sRh; }
float stateHeatIndexC() { return sHeatIndex; }
float stateLastValidTempC() { return sLastValidTemp; }
float stateLastValidRhPct() { return sLastValidRh; }
