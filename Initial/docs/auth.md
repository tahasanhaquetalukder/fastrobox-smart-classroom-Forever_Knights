# Authentication and access model

Task 2 uses protected reads (option B, selected at the checkpoint). Admin checks
use constant-time comparison of `X-Admin-Token`; mutations fail closed if the
server has no `ADMIN_TOKEN`. Device tokens are random, stored only as SHA-256
hashes, and can be issued, rotated and revoked.

## Endpoint matrix

| Endpoint | Required access |
|---|---|
| `GET /health` | Public; returns only service/DB reachability and safe errors. |
| `POST /api/device/telemetry` | Active per-device token, or explicitly enabled shared bootstrap. |
| `POST /api/device/events` | Active per-device token; revoked tokens rejected. |
| `GET /api/device/commands` | Active per-device token; only that device's commands. |
| `POST /api/device/commands/:id/ack` | Active per-device token; only that device's command. |
| `POST /api/devices` | Admin; issues a token and returns its plaintext once. |
| `POST /api/devices/:id/token` | Admin; rotates a token and returns its plaintext once. |
| `POST /api/devices/:id/revoke` | Admin; revokes access without exposing the hash. |
| `GET /api/settings` | Read/admin token, or a device token. |
| `PUT /api/settings` | Admin on every call. |
| `GET /api/readings` | Read or admin token. |
| `GET /api/events` | Read or admin token. |
| `GET /api/attendance` | Read or admin token. |
| `GET /api/door` | Read or admin token. |
| `POST /api/door` | Admin on every call; creates a device command. |
| `GET /api/stream` (SSE) | Read or admin token in headers, never in the URL. |
| Dashboard static files | Public shell; protected APIs decide what data it can read. |
| Future snapshot/face/OTA mutations | Admin required from their first implementation. |

## Device-token model

- Prefer one random token per device. The database stores its SHA-256 hash,
  never the plaintext token.
- Hash lookup is followed by a constant-time hash comparison. Revoked devices
  are rejected even if an old token hash remains in the database.
- Issue and rotate responses show the plaintext once for provisioning. Token
  values and hashes are never logged or returned by other management responses.
- `POST /api/devices` requires JSON `deviceId` and `roomId`, with optional `name`.
  Rotation and revocation take the device id in the URL. All three require admin.
- Rotation is rejected for revoked devices. Revocation clears the active hash.
- Shared `DEVICE_TOKEN` bootstrap requires both the token and
  `DEVICE_BOOTSTRAP_ENABLED=true`. It cannot revive a revoked device. With the
  flag unset or false, presenting the shared token has no effect.

## Protected reads and SSE

`READ_TOKEN` grants read-only access and `ADMIN_TOKEN` grants both read and
mutation access. At least one must be configured or protected reads return 503.
Dashboard/history/SSE callers use `X-Read-Token` or `X-Admin-Token`. Devices use
`X-Device-Token` or Bearer authorization for settings and device endpoints.

The dashboard uses `fetch` with a streaming SSE parser instead of native
`EventSource`, so authorization is sent in headers. Tokens never appear in URLs.
The read/admin token is kept only in memory and `sessionStorage` for the current
browser tab, never in `localStorage`. A 401 asks for a valid token; a 503 means
the server administrator must configure authentication.

## Rate limits and errors

Per-IP fixed-window limits cover authentication failures and all API writes.
Configure `AUTH_FAILURE_LIMIT`, `WRITE_LIMIT` and `RATE_LIMIT_WINDOW_MS`; Render
sets explicit values. Responses use 429 with `Retry-After`. Internal errors are
redacted in logs and replaced with generic messages in HTTP responses.

## Firmware audit — UNTESTED ON DEVICE

- Provisioning starts only when BOOT is deliberately held during reset. An open
  AP is no longer started merely because Wi-Fi configuration is absent.
- The local status page is read-only and exposes no tokens or Wi-Fi password.
- HTTPS requires an `https://` server URL and a provisioned PEM root CA. The
  firmware calls `setCACert()` and has no `setInsecure()` fallback.
- These changes are compile-verified only until run on the physical kit. GPIOs
  remain **VERIFY ON MY BOARD**.
