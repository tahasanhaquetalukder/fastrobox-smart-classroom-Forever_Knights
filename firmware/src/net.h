#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

void netBegin();
void netLoop();                 // net task body
bool netOnline();               // Wi-Fi + backend reachable
bool netBackendOnline();
bool netTimeReady();
uint32_t netEpoch();
void netQueueEvent(const char* type, const char* detail);
void netQueueEvent(const char* type, const char* detail, JsonDocument& payload);
bool netApplySettings(JsonObject settings);
size_t netSpoolSize();
