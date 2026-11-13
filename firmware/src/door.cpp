#include "door.h"
#include "state.h"

static DoorState sState = DOOR_LOCKED;
static uint32_t sAutoLockAt = 0;
static bool sChanged = false;

void doorBegin() {
  sState = DOOR_LOCKED;
  sAutoLockAt = 0;
  sChanged = false;
  if (stateFireLatched()) {
    sState = DOOR_UNLOCKED;  // fire latch survives power loss; stay open
    Serial.println("[STATUS] door restored UNLOCKED (fire latch persisted)");
  } else {
    Serial.println("[STATUS] door initialized LOCKED");
  }
}

void doorLock() {
  if (stateFireLatched()) {
    Serial.println("[STATUS] lock ignored: fire latch active");
    return;
  }
  if (sState != DOOR_LOCKED) {
    sState = DOOR_LOCKED;
    sAutoLockAt = 0;
    sChanged = true;
    Serial.println("[STATUS] door LOCKED");
  }
}

bool doorUnlock(uint32_t autoLockMs) {
  uint32_t until = autoLockMs > 0 ? millis() + autoLockMs : 0;
  if (stateFireLatched()) until = 0;  // door must stay open until authorized reset
  bool changed = sState != DOOR_UNLOCKED || until != sAutoLockAt;
  sState = DOOR_UNLOCKED;
  sAutoLockAt = until;
  if (changed) {
    sChanged = true;
    Serial.println("[STATUS] door UNLOCKED");
  }
  return changed;
}

bool doorTakeChanged() {
  bool c = sChanged;
  sChanged = false;
  return c;
}

DoorState doorGetState() { return sState; }
const char* doorStateStr() { return sState == DOOR_UNLOCKED ? "UNLOCKED" : "LOCKED"; }

void doorTick() {
  if (stateFireLatched() && sState == DOOR_LOCKED) {
    doorUnlock(0);  // latch may have been restored from NVS after boot
    return;
  }
  if (sState == DOOR_UNLOCKED && sAutoLockAt && (int32_t)(millis() - sAutoLockAt) >= 0) {
    doorLock();
  }
}
