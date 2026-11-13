#pragma once
#include <Arduino.h>

const char* sysResetReason();
const char* sysChipModel();
float sysChipTempC();
uint32_t sysHeapKb();
