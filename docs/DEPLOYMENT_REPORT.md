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

## 6. Not verified

- **Judge account login on Render** — the Render environment's judge e-mail/
  password variables and seeded accounts are owner-managed; no credentials were
  available. No login was attempted with guessed passwords (would risk lockout).
- **Notification delivery** — `NOTIFY_PROVIDER=log`; no Telegram/Resend/webhook
  credentials are configured, so delivery is not claimed.
- **Physical hardware** — no ESP32-S3, sensors, RFID reader, LED, buzzer or
  touch pad attached. All physical checks remain pending.
- **Render dashboard commit field / deploy logs** — requires owner access.

## 7. Owner next steps

1. Open the Render dashboard for `fastrobox-smart-classroom`, confirm the live
   deploy corresponds to commit `ce074df` and check the deploy log for
   migration errors.
2. Set the judge variables (`ADMIN_PASSWORD`, `TEACHER_PASSWORD`,
   `STUDENT1_PASSWORD`, `STUDENT2_PASSWORD`, `GUARDIAN_PASSWORD`, plus e-mails
   and card UIDs if desired) in Render, then run `npm run seed:users` once
   against the Render `DATABASE_URL`.
3. Optionally configure `NOTIFY_PROVIDER` and provider credentials, then test a
   FIRE/PANIC notification.
4. Run the physical tests listed in `docs/LEVEL_1_TO_4_COMPLETION_REPORT.md`
   §12 and record the results.
