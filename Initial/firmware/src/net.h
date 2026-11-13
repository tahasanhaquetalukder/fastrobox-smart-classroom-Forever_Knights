#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

void netBegin();
bool netOnline();
void netSendTelemetry(float t, float h, bool flame, const char* doorState);
void netSendEvent(const char* type, JsonDocument& payload);  // buffers if offline
void netPollCommands();
void netFetchSettings();
void netFlush();
void netTick(float t, float h, bool flame);