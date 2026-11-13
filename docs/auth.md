# Authentication and access model

Levels 1–4 use three independent authentication paths:

1. **People** — email/password accounts with bcrypt hashes and server-side
   sessions.
2. **Devices** — per-device random tokens stored only as SHA-256 hashes.
3. **Legacy operator tokens** — `ADMIN_TOKEN` / `READ_TOKEN`, retained for
   scripts and judges, but not the primary dashboard path.

No password, token or key is committed to the repository.

## Roles and scope

| Role | Capabilities | Scope |
|------|--------------|-------|
| **Admin** | Manage all rooms, devices, cards, users, schedules and settings; view every log; reset/silence fire in any room | Global |
| **Teacher** | Assigned rooms only; live safety state; acknowledge/silence and authorized Reset Fire; event/attendance history | Rooms in `room_assignments` |
| **Student** | Own attendance only (today + history) | Own `user_id` |
| **Guardian** | Linked children only: today's arrival time and attendance history | `guardian_links` |

Enforcement is server-side on every protected route (`requireAuth`,
`requireRole`, `assertRoomAccess`). The frontend hides controls but is never the
security boundary.

## Login, lockout and sessions

- Passwords are hashed with bcrypt (`BCRYPT_ROUNDS`, default 10).
- `LOGIN_MAX_FAILURES` (default 5) wrong passwords lock the account for
  `LOGIN_LOCK_MS` (default 30 000 ms).
- The lock check happens **before** password comparison, so the correct password
  cannot bypass an active lock.
- Successful login clears `failed_attempts` and `locked_until`.
- All failures return the same message and take comparable bcrypt work, so the
  API does not reveal whether an account exists.
- A session token is a 32-byte random value returned once. Only its SHA-256 hash
  is stored with an expiry (`SESSION_TTL_HOURS`, default 12) and client metadata.
- Logout deletes the session. Deactivating a user or changing a password deletes
  all their sessions.
- Login attempts are recorded in `login_history` (success/failure, reason, IP,
  user agent) and can be viewed by admins.

The dashboard keeps the session token in memory and `sessionStorage` only — not
`localStorage`.

## Judge accounts

`npm run seed:users` creates Admin, Teacher, Student S1, Student S2 and Guardian
accounts idempotently:

| Account | Default email | Password source |
|---------|---------------|-----------------|
| Admin | `admin@smartclass.local` | `ADMIN_PASSWORD`, else generated + printed once |
| Teacher | `teacher@smartclass.local` | `TEACHER_PASSWORD`, else generated + printed once |
| Student S1 | `student1@smartclass.local` | `STUDENT1_PASSWORD`, else generated + printed once |
| Student S2 | `student2@smartclass.local` | `STUDENT2_PASSWORD`, else generated + printed once |
| Guardian (linked to S1) | `guardian@smartclass.local` | `GUARDIAN_PASSWORD`, else generated + printed once |

The seeder assigns the teacher and both students to `DEFAULT_ROOM_ID`, links the
guardian to Student S1, and can bind card UIDs from `TEACHER_CARD_UID`,
`STUDENT1_CARD_UID`, `STUDENT2_CARD_UID`. Re-running the seeder does not change
an existing password.

Local demo (`node tools/dev-pglite.js`) uses the same accounts with
`DEV_*_PASSWORD` overrides and random passwords otherwise.

## Device authentication

- `POST /api/devices` (admin) issues a token and returns the plaintext **once**;
  only its hash is stored.
- `POST /api/devices/:id/token` rotates; `POST /api/devices/:id/revoke` revokes.
- Devices send `X-Device-Token` plus `X-Device-Id`. Revoked devices are rejected
  even if an old hash remains.
- Shared `DEVICE_TOKEN` bootstrap is disabled unless
  `DEVICE_BOOTSTRAP_ENABLED=true` and it cannot revive a revoked device.
- The firmware also requires a WPA2 setup AP password (8 characters, printed on
  Serial during provisioning) and stores the device token in NVS.

## Legacy tokens

`ADMIN_TOKEN` and `READ_TOKEN` still work for operator endpoints and judge
scripts. User sessions take precedence. When neither legacy token is configured,
protected reads return 401 rather than opening access. They are optional and
should be left empty in production unless a script needs them.

## Endpoint matrix (summary)

| Endpoint | Required access |
|---|---|
| `GET /health`, dashboard static shell | Public |
| `POST /api/auth/login` | Public, rate-limited |
| `GET /api/auth/me`, `POST /api/auth/logout` | Session |
| `GET /api/dashboard`, `/api/dashboard/events` | Session, role-scoped |
| `POST /api/fire/reset`, `/api/fire/silence`, `GET /api/fire/state` | Admin or assigned Teacher |
| `/api/admin/*` | Admin |
| `POST /api/device/telemetry`, `/events`, `GET /commands`, `POST /commands/:id/ack` | Active device token |
| `GET /api/settings` | Session (legacy read/admin tokens also accepted) |
| `PUT /api/settings` | Admin (validation before DB access) |
| `GET /api/readings`, `/events`, `/attendance`, `/door` | Session, role-scoped (legacy tokens allowed) |
| `POST /api/door` | Admin or assigned Teacher |
| `GET /api/stream` | Session via header (never a URL token) |

## Rate limits and errors

Per-IP fixed windows cover login failures and API writes. Responses use 429 with
`Retry-After`. Internal errors are redacted in logs and replaced with generic
messages in HTTP responses. Account lockout is separate and per-account.

## Firmware security notes

- HTTPS uses `setCACert()` with a built-in public root CA or a PEM provisioned
  into NVS; `setInsecure()` is never called.
- The local status page exposes no tokens or Wi-Fi password.
- Provisioning requires physical proximity (join the AP with the printed
  password). BOOT held 5 s wipes Wi-Fi and returns to setup.
- All of the above is compile-checked; physical verification is still required.
