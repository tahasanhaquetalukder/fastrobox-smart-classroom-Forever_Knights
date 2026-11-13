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
| Arduino-ESP32 framework | Version supplied by the currently unpinned `espressif32` platform | LGPL-2.1 | Wi-Fi, HTTPS, WebServer, DNS, NVS Preferences, LittleFS, SPI and ESP32 board support. |

The firmware platform is currently unpinned in `firmware/platformio.ini`; the
exact resolved platform should be recorded before a reproducible contest build.

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

No external face-recognition API, snapshot storage service or NTP service is in
use yet. Any added later must be appended to this inventory with its purpose,
version and licence/terms.

## Own-work policy

Application, firmware, dashboard, simulator and repository-tool source files
are written for this project. Third-party packages are referenced through their
package managers rather than copied into the repository. If an official
documentation snippet is ever adapted, its source must be noted in a nearby
code comment and this file must be updated if it adds a dependency.