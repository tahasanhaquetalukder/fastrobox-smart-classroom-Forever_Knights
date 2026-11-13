#pragma once
// ============================================================================
// PIN MAP — ESP32-S3-CAM  (ALL pins in one place)
//
// IMPORTANT: Every number below is a PLACEHOLDER. The camera connector and
// PSRAM occupy many GPIOs on ESP32-S3-CAM boards, and free pins differ between
// variants (Freenove / AI-Thinker / Goouuu / ...). You MUST check YOUR board's
// schematic and record confirmed pins in docs/pin-map.md BEFORE wiring.
//
// Known fixed pins on most ESP32-S3-CAM boards:
//   GPIO0  = BOOT button (strapping; hold LOW at reset)
//   GPIO19/20 = USB D-/D+ (avoid if using native USB)
//   GPIO48 = onboard WS2812 RGB LED on many Freenove S3 boards (verify!)
//   GPIO26..32 = flash/PSRAM (do NOT use)
// The camera typically uses a block of GPIO1..18 — the RC522 SPI defaults below
// may overlap those on some variants. Camera is NOT used in Levels 1-4, so
// remap freely now and re-check when the camera is enabled in a later phase.
// ============================================================================

// --- DHT11 temperature / humidity (single data pin) ---
#define DHT_PIN            47   // TODO: verify free GPIO on your board
#define DHT_TYPE           DHT11

// --- IR flame sensor (3-pin module, digital DO output) ---
#define FLAME_PIN          14   // TODO: verify free GPIO
#define FLAME_ACTIVE_LOW   1    // most modules pull DO LOW when flame present; verify

// --- Active buzzer (HIGH = sound) ---
#define BUZZER_PIN         21   // TODO: verify free GPIO

// --- RC522 RFID reader (SPI bus) — may overlap camera pins; verify/remap ---
#define RFID_SS_PIN        10   // TODO: verify (SDA/SS)
#define RFID_RST_PIN       9    // TODO: verify (RST)
#define RFID_SCK_PIN       12   // TODO: verify (SCK)
#define RFID_MISO_PIN      13   // TODO: verify (MISO)
#define RFID_MOSI_PIN      11   // TODO: verify (MOSI)

// --- Onboard addressable RGB LED (WS2812) ---
#define RGB_LED_PIN        48   // TODO: verify (often GPIO48 on Freenove S3 CAM)
#define RGB_LED_COUNT      1

// --- BOOT button (GPIO0 strapping pin; LOW while pressed) ---
#define BOOT_PIN           0    // hold at reset for setup AP; hold 5s at runtime to clear Wi-Fi

// --- Panic touch pad (jumper wire on a capacitive-touch GPIO) ---
// ESP32-S3 touch channels are GPIO1..GPIO14. GPIO4 is used by many S3 camera
// headers — verify it does not clash with your camera/PSRAM wiring.
#define PANIC_TOUCH_PIN    4    // TODO: verify touch-capable + free GPIO

// Do not wire until every pin above is confirmed against your board variant.
