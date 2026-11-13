# Deployment report — Levels 1–4

Date: 2026-11-13
Repository: `tahasanhaquetalukder/fastrobox-smart-classroom-Forever_Knights`
Branch: `main` · Remote: `origin` (GitHub, HTTPS)
Deployed URL: `https://fastrobox-smart-classroom.onrender.com/`

This report records what was actually executed and observed. Items that could
not be verified with available access are marked explicitly.

---

## 1. Commit and push

| Item | Result |
|------|--------|
| Commit | `ce074df` — `feat(level-4): complete Levels 1-4 safety, access and RBAC` |
| Parent | `86df0ac` (`basic`) |
| Author | `tahasanhaquetalukder <tahasan5800p@gmail.com>` (existing repo identity, one-off `-c` override; local Git config unchanged) |
| Changes | 85 files, +10,020 / −1,217 |
| Push | `86df0ac..ce074df  main -> main` (plain push, no force, no history rewrite) |
| Follow-up | `bd628d3` — `docs: record Level 1-4 commit, push and Render deployment results`; runtime code unchanged |
| Follow-up | `f5716b0` — `docs: record judge-account seeding gap behind the Render login failure` |
| Follow-up | `9996225` — `fix(db): add missing device health columns for databases where 002 was applied early` (adds `007_devices_health_columns.sql`) |
| Remote head | `main` = `99962255199e7bbfc990843efa9c1fc4fd9e2a26` (plain pushes, no force, no history rewrite) |

GitHub verification:

```
git ls-remote origin main
ce074df3789cda3028f030e291ee5979d031b48d  refs/heads/main
```

The GitHub REST API returns the same SHA for
`/repos/tahasanhaquetalukder/fastrobox-smart-classroom-Forever_Knights/commits/ce074df`.

## 2. Pre-commit safety checks

| Check | Command | Result |
|-------|---------|--------|
| Staged secret scan | `node tools/rules-guard.js --staged` | PASS — 166 text files |
| Full history secret scan | `node tools/rules-guard.js --history` | PASS — 107 blobs, 13 messages (before commit) |
| Full compliance | `node tools/git-compliance-check` | PASS — all 10 checks, one consistent identity |
| Backend tests | `npm test` | 21 tests, 21 pass, 0 fail |
| Firmware build | `pio run` / `pio run -t buildfs` | SUCCESS (recorded in the completion report) |

After commit, the compliance check re-scanned 191 blobs and 14 messages and
reported `[compliance] PASS all checks`.

The initial staged scan produced false positives in `.env.example`
(empty `ADMIN_TOKEN` followed by `READ_TOKEN` matched across a line break),
five test-fixture password literals, and a local variable named `token` in the
dev server. These were fixed at the source (placeholder-style test passwords,
a comment separator in `.env.example`, renamed local variable). The scanner was
not modified, disabled, or bypassed.

## 3. What was not committed

Confirmed absent from the commit:

- `.env` (does not exist locally; `.env.example` only)
- `firmware/.pio/` build output (`firmware.bin`, `firmware.elf`, `spiffs.bin`)
- `backend/node_modules/`
- `tools/simulator/spool.jsonl` (deleted after the simulator test)
- `Initial/` (not modified, not staged)
- No private keys, tokens, credentials, database URLs, face data or snapshots

## 4. Render service and auto-deploy

- Existing Render web service and database were used; no new service, project
  or repository was created.
- `render.yaml` keeps `rootDir: backend`, `buildCommand: npm install`,
  `startCommand: npm run migrate && npm start`, `healthCheckPath: /health` and
  `autoDeploy: true` (line 14).
- No `RENDER_API_KEY`, Render CLI, or dashboard credentials were available in
  this environment, so deployment logs and the Render-side commit field could
  not be read directly.
- Deployment was verified from the public service behavior instead (below).
  The commit timestamp is 06:10:34Z; the first probe after the push (06:11:21Z)
  still saw the old revision, and the new API surface was live by
  **06:12:02Z** (12:12 Dhaka), consistent with the configured auto-deploy.

## 5. Deployed-revision evidence

Baseline before the deploy (old `basic` revision):

```
GET /health              200 {"status":"ok","db":"up"}
GET /api/fire/state      404 {"error":"not found"}
GET /api/auth/me         404 {"error":"not found"}
```

After the push and auto-deploy:

```
GET /health              200 {"status":"ok","db":"up","time":"2026-11-13T06:12:39.509Z"}
GET /api/fire/state      401 {"error":"authentication required"}
GET /api/auth/me         401 {"error":"authentication required"}
GET /api/dashboard/summary 401 {"error":"authentication required"}
GET /api/settings        401 {"error":"valid read or admin token required"}
GET /api/readings        401 {"error":"valid read or admin token required"}
POST /api/auth/login     401 {"error":"invalid credentials or account temporarily locked"}
```

The new routes and the generic login failure (no account-existence leak) only
exist in `ce074df`. `/health` reporting `db: up` shows the migration step in
`startCommand` completed against Render PostgreSQL; a failed migration would
have prevented the service from starting.

Dashboard assets served by Render were diffed against the committed files
(ignoring CRLF only):

```
index.html  identical
app.js      identical
styles.css  identical
```

The served `index.html` contains the login form and the Bangla (বাংলা) language
option; the served `app.js` contains `loginForm`, `canControl`,
`resetFireBtn2` and `status.FIRE`.

## 6. Judge accounts and production schema repair

**Accounts.** `npm run seed:users` was run once from this machine with the
Render *External Database URL* supplied by the owner. The URL and the generated
passwords were kept out of the repository, `.env`, and all committed files. The
seeder reported `created=ADMIN,TEACHER,STUDENT1,STUDENT2,GUARDIAN`
(e-mails `admin|teacher|student1|student2|guardian@smartclass.local`,
room `ROOM-1`). Passwords were generated by the seeder, printed once, and handed
to the owner out of band; they are not recorded here.

**Production schema repair.** The first authenticated call exposed a real
deployment defect: `GET /api/dashboard/summary` returned 500. Comparing a
freshly migrated schema (PGlite, all migrations) with the Render database showed
eight missing columns, all on `devices`:
`status, fire_latched, last_reset_reason, firmware, uptime_s, rssi, heap_kb, chip_temp_c`.
Cause: `002_device_auth.sql` had already been applied to the Render database at
`2026-11-13T02:59:48Z`; the device-health `ALTER TABLE` block was added to the
same file afterwards and the migration runner correctly skipped the
already-recorded file. No other drift was found.

Fix: new additive, idempotent migration
`backend/src/db/migrations/007_devices_health_columns.sql` (eight
`ADD COLUMN IF NOT EXISTS` statements, no drops, no data change). It was
committed as `9996225` and applied by Render's existing start command during the
auto-deploy (`schema_migrations` shows `007` applied; `devices` now has 8/8
columns). Backend tests were run before the push: 21/21 pass.

**Verified against the deployed service after the repair** (read-only checks and
authenticated sessions, each session logged out afterwards):

| Account / check | Result |
|---|---|
| `admin` login → `/api/auth/me` | 200, role `admin`, rooms `["ROOM-1"]`, permissions `manage/resetFire/viewRoom` |
| `admin` → `/api/dashboard/summary` | 200, `ok=true`, selected `ROOM-1`, room state `SAFE` |
| `admin` → `/api/dashboard/events`, `/api/readings`, `/api/settings`, `/api/devices`, `/api/fire/state?roomId=ROOM-1` | 200, 200, 200, 200, 200 |
| `teacher` → `summary` / `events` / `devices` | 200 with room snapshot, 200, 403 (admin-only) |
| `student1`, `student2` → `summary` | 200, role-scoped attendance view, no room snapshot |
| `guardian` → `summary` | 200, one linked child |
| logout → reuse of the same token | 200, then 401 |

## 7. Not verified

- **Notification delivery** — `NOTIFY_PROVIDER=log`; no Telegram/Resend/webhook
  credentials are configured, so delivery is not claimed.
- **Physical hardware** — no ESP32-S3, sensors, RFID reader, LED, buzzer or
  touch pad attached. All physical checks remain pending.
- **Render dashboard commit field / deploy logs** — requires owner access; the
  deployed behavior above is the evidence available from outside.
- **Fire reset / device commands in production** — deliberately not executed;
  these change shared state and were not part of the verification.

## 8. Owner next steps

1. Store the generated judge passwords securely; do not paste them into the
   repository, issues, or chat. Change any you consider compromised via
   `PATCH /api/admin/users/<id>` with `{"password":"..."}` (also deletes that
   user's sessions).
2. The Render *External Database URL* including its password was shared in chat
   during this session. Consider rotating the database password in the Render
   dashboard; Render rewrites `DATABASE_URL` for the service automatically.
   Re-runs of `npm run seed:users` after a rotation need the new URL. Existing
   accounts keep their passwords (`(existing, password unchanged)`).
3. Optionally configure `NOTIFY_PROVIDER` and provider credentials, then test a
   FIRE/PANIC notification.
4. Run the physical tests listed in `docs/LEVEL_1_TO_4_COMPLETION_REPORT.md`
   §12 and record the results.
5. If more migrations are added, never edit a migration file that has already
   been applied; add a new numbered file instead (the cause of the repair in
   §6).
