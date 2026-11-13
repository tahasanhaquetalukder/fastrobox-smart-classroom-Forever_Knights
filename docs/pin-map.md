# Pin Map — ESP32-S3-CAM (TODO: fill after checking YOUR board)

> **Do not wire until confirmed.** The camera connector and PSRAM use many
> GPIOs on ESP32-S3-CAM boards, and free pins differ between variants
> (Freenove / AI-Thinker / Goouuu / ...). The "Default" column below matches the
> placeholders in [`firmware/src/pins.h`](../firmware/src/pins.h). Check your
> board schematic, fill the **Confirmed GPIO** column, then update `pins.h` to
> match. Camera is **not** used in Phase 1, so you can remap freely now.

## Signal table

| Peripheral | Signal | Default GPIO (placeholder) | Confirmed GPIO | Notes |
|------------|--------|----------------------------|----------------|-------|
| DHT11 | DATA | 47 | ____ | 10k pull-up to 3V3 if bare sensor |
| IR flame | DO | 14 | ____ | digital out; check polarity below |
| Buzzer (active) | I/O | 21 | ____ | HIGH = sound; drive via transistor if >20mA |
| RC522 RFID | SDA/SS | 10 | ____ | **3.3V only** |
| RC522 RFID | SCK | 12 | ____ | SPI clock |
| RC522 RFID | MOSI | 11 | ____ | SPI out |
| RC522 RFID | MISO | 13 | ____ | SPI in |
| RC522 RFID | RST | 9 | ____ | reset |
| RGB LED (WS2812) | DIN | 48 | ____ | onboard; often GPIO48 on Freenove S3 |
| Panic touch pad | TOUCH | 4 | ____ | capacitive pad via jumper wire; **must be a touch-capable GPIO free on your variant** |
| BOOT button | — | 0 | 0 | fixed strapping pin; hold LOW at reset |

## Power wiring

| Peripheral | VCC | GND | Warning |
|------------|-----|-----|---------|
| RC522 | **3V3** | GND | **NOT 5V tolerant — 5V will damage it.** |
| DHT11 | 3V3 (or 5V) | GND | 3V3 preferred with ESP32 |
| IR flame | 3V3 (or 5V) | GND | DO is open-collector on many modules |
| Buzzer | 3V3 / 5V | GND | active buzzer; mind current draw |

## Fixed / reserved pins (do not repurpose)

- **GPIO0** — BOOT button (strapping). Used to force provisioning AP.
- **GPIO19 / GPIO20** — USB D- / D+ (avoid if using native USB CDC).
- **GPIO26..32** — flash / PSRAM (do not use).
- **GPIO48** — onboard RGB LED on many Freenove S3 boards (verify).
- **Camera block** — typically a range of GPIO1..18 (XCLK, PCLK, VSYNC, HREF,
  SIOD/SIOC, Y2..Y9). Exact pins vary; consult your board. The RC522 SPI
  defaults may overlap these — remap if needed.

## Flame sensor polarity

Most 3-pin IR flame modules pull **DO LOW when flame is detected**. The firmware
assumes this (`FLAME_ACTIVE_LOW 1` in `pins.h`). Verify with a lighter/test:
if the reading is inverted, set `FLAME_ACTIVE_LOW 0`.

## Checklist

- [ ] Confirmed every GPIO above against my board schematic.
- [ ] Updated `firmware/src/pins.h` to match the Confirmed column.
- [ ] RC522 powered from **3V3**, not 5V.
- [ ] Verified flame DO polarity.
- [ ] Verified RGB LED pin (lit during boot).
- [ ] Verified the panic pad GPIO is touch-capable, not used by the camera/flash,
      and calibrated (`touch` task prints the baseline on Serial).
- [ ] No peripheral pin conflicts with the camera block (for later phases).