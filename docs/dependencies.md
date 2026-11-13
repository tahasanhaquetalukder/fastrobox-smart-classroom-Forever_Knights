# Third-party dependencies and services

This inventory covers direct libraries, runtimes and hosted services. npm
transitive packages and their exact versions are locked in
`backend/package-lock.json`. Firmware libraries are installed by PlatformIO;
build output and downloaded libraries are not committed.

Versions below show the declared constraint followed by the locally installed
version used for this audit. No new library was needed for the repository
compliance tools; they use Node.js built-ins only.

## Backend (Node.js)

| Name | Declared / installed | Licence | Why it is used |
|---|---|---|---|
| dotenv | `^16.4.5` / 16.6.1 | BSD-2-Clause | Loads local environment configuration; Render supplies environment variables directly. |
| Express | `^4.19.2` / 4.22.3 | MIT | HTTP routing, JSON APIs, SSE responses and static dashboard hosting. |
| pg | `^8.12.0` / 8.23.1 | MIT | PostgreSQL connections, parameterized queries and migrations. |
| bcryptjs | `^2.4.3` / 2.4.3 | MIT | Password hashing for Level-4 accounts (pure JS, no native build). |

Development/test only:

| Name | Declared / installed | Licence | Why it is used |
|---|---|---|---|
| @electric-sql/pglite | `^0.2.17` / 0.2.17 | Apache-2.0 | In-process PostgreSQL (WASM) for the test suite and the local UI demo. Not used in production or during Render startup. |

The device simulator and Git tools add no npm dependencies. They use standard
Node.js modules and the built-in `fetch` implementation.

## Firmware (PlatformIO / Arduino)

| Name | Declared / installed | Licence | Why it is used |
|---|---|---|---|
| DHT sensor library | `^1.4.6` / 1.4.7 | MIT | Reads the DHT11 temperature and humidity sensor. |
| Adafruit Unified Sensor | `^1.1.14` / 1.1.15 | Apache-2.0 | Sensor abstraction required by the DHT library. |
| MFRC522 | `^1.4.11` / 1.4.12 | Unlicense | RC522 RFID card/tag communication over SPI. |
| ArduinoJson | `^7.2.0` / 7.4.3 | MIT | JSON telemetry, events, settings and command parsing. |
| Adafruit NeoPixel | `^1.12.3` / 1.15.5 | LGPL-3.0 | Controls the onboard RGB LED for door and safety status. |
| Arduino-ESP32 framework | platform `espressif32` 8.0.0 → framework 4.30312.261024 (ESP32-S3 libs 3.3.12) | LGPL-2.1 | Wi-Fi, HTTPS, WebServer, DNS, NVS Preferences, LittleFS, SPI and ESP32 board support. |
| xtensa-esp-elf toolchain | 14.2.0+20260121 | GPL-3.0 with GCC runtime exception | Compiler/linker for the ESP32-S3. |

The firmware platform is declared as unpinned `espressif32` in
`firmware/platformio.ini`. The versions above are the exact resolved set used
for the successful `pio run` / `buildfs` on 2026-11-13; pin
`platform = espressif32@8.0.0` if a byte-reproducible contest build is required.

## Build and runtime platforms

| Name | Version | Licence / terms | Why it is used |
|---|---|---|---|
| Node.js | `>=18`; audited with 26.13.0 | MIT | Backend, simulator and repository tooling runtime. |
| PlatformIO Core | 6.2.0 | Apache-2.0 | Firmware dependency management and ESP32 builds. |
| PostgreSQL | Managed by Render | PostgreSQL Licence | Persistent settings, telemetry, events and attendance storage. |

## Hosted services

| Service | Plan / version | Licence / terms | Why it is used |
|---|---|---|---|
| GitHub | Hosted service | GitHub hosted-service terms | Remote Git history, collaboration and judge read access. |
| Render Web Service | Free plan | Render hosted-service terms | Public HTTPS deployment of the Express API and dashboard. |
| Render PostgreSQL | Free plan | Render hosted-service terms; PostgreSQL engine under the PostgreSQL Licence | Managed database for the deployed backend. |
| Telegram Bot API | Optional | Telegram terms | Optional safety-alert delivery (`NOTIFY_PROVIDER=telegram`). Not used unless a bot token and chat id are configured. |
| Resend email API | Optional | Resend terms | Optional safety-alert email delivery (`NOTIFY_PROVIDER=email`). Not used unless an API key and sender/recipient are configured. |

NTP is resolved at runtime from public servers (`pool.ntp.org`,
`time.nist.gov`, `time.google.com`) with no account or key required. The device
also validates the backend certificate against a public root CA (GTS Root R4),
which is a public trust anchor, not a secret.

No external face-recognition API, snapshot storage service or NTP service is in
use yet. Any added later must be appended to this inventory with its purpose,
version and licence/terms.

## Own-work policy

Application, firmware, dashboard, simulator and repository-tool source files
are written for this project. Third-party packages are referenced through their
package managers rather than copied into the repository. If an official
documentation snippet is ever adapted, its source must be noted in a nearby
code comment and this file must be updated if it adds a dependency.