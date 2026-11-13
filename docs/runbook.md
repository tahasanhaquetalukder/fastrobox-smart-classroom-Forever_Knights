# Contest runbook

This runbook is for team **Forever_Knights**. Keep secrets in environment
variables or device NVS only. Never put real credentials, database connection
strings, face data, snapshots or firmware binaries in Git.

## Local bring-up (database + accounts)

```bash
cd backend
npm install
cp ../.env.example ../.env        # set DATABASE_URL; leave secrets blank for now
npm run migrate                   # additive, idempotent
npm run seed:users                # prints generated passwords ONCE
npm run seed:device -- --device-id classroom-01 --room ROOM-1
npm test                          # PGlite integration suite
npm run dev
```

For a UI-only demo without PostgreSQL: `node tools/dev-pglite.js`.

Then open `http://localhost:3000`, sign in with the seeded admin account and
confirm the dashboard loads with an explicit empty/offline state (not fabricated
values).

## Firmware build, upload and provisioning

```bash
cd firmware
pio run                 # compile
pio run -t uploadfs     # LittleFS status-page assets
pio run -t upload       # flash (set upload_port/board for your variant)
pio device monitor      # 115200
```

1. On first boot with no Wi-Fi, the node starts `SmartClass-Forever_Knights`.
   The Serial console prints the 8-character WPA2 setup password.
2. Join the AP and open `http://192.168.4.1/`.
3. Scan for the classroom Wi-Fi, then enter SSID/password, Room ID, HTTPS server
   URL, device token, thresholds, timings and teacher/student card UIDs.
4. Save; the device reboots onto the network and sends `BOOT`.
5. Open `http://<device-ip>/` or `http://smartclass-foreverknights.local/` and
   confirm the 2 s refresh shows real values (not placeholders).
6. Hold BOOT for 5 s to wipe Wi-Fi and return to setup.

Serial: `help`, `status`, `health`, `tasks`, `ver`, `hang`, `reset`, `seq`,
`settings`, `wifi-reset`. `hang` deliberately blocks the serial task; the
watchdog must restart the board within 10 s.

## Safety drill (physical)

1. Flame for 2 s → FIRE, red 5 Hz, continuous buzzer, door unlocked, cloud event
   within 3 s.
2. Remove flame → buzzer may be silenced by a **teacher** card or dashboard;
   student cards must not silence. Door stays unlocked.
3. Power-cycle → FIRE stays latched and door stays unlocked until an authorized
   Reset Fire (dashboard Admin/Teacher or teacher card after flame gone).
4. Touch panic pad <1 s → ignored; ≥2 s → PANIC, cloud event within 3 s.
5. Unplug DHT11/RFID → SENSOR ERROR within 12 s / 3 s; replug → recovery.

Record observed timings. Do not claim these passed without the hardware.

## Notifications

Set `NOTIFY_PROVIDER` to `log` (default), `telegram`, `email` or `webhook` and
provide the matching credentials in the environment/Render dashboard. Verify the
provider first with a test alert, then check `notification_log` for
`sent`/`failed`. With `log` or missing credentials the service records `skipped`
and must not be described as delivering alerts.

## Render deployment verification

Deployment is a manual, verified action — never claim it without evidence.

1. Confirm the Blueprint uses `rootDir: backend`, `npm install`,
   `npm run migrate && npm start`, `/health`, and the PostgreSQL binding.
2. Set `DEFAULT_ROOM_ID`; let Render generate `ADMIN_TOKEN`, `READ_TOKEN` and
   `DEVICE_TOKEN`. Set `NOTIFY_PROVIDER` deliberately.
3. Deploy, then verify:
   - `GET https://fastrobox-smart-classroom.onrender.com/health` → `status: ok`;
   - dashboard loads over HTTPS and login works;
   - migrations ran (no startup error in logs);
   - `/api/dashboard` returns 401 without a session;
   - a device token can post telemetry and a FIRE event;
   - CORS/static assets load and security headers are present.
4. Run `npm run seed:users` once from the Render Shell; capture generated
   passwords securely and share them with judges through the agreed channel.
5. Put the public URL and device token into provisioning.

Rollback: redeploy the previous successful commit from Render. Do not reset the
database; migrations are additive.

## Git safety and hooks

The repository tools use Node.js built-ins and run from the repository root.

```bash
# Optional: install the local pre-commit and commit-msg guards.
node tools/install-hooks.js

# Scan the current staged tree or the complete history.
node tools/rules-guard.js --staged
node tools/rules-guard.js --history

# Full repository check; requires a clean worktree on branch main.
node tools/git-compliance-check
```

The installer never overwrites a different existing hook and never changes Git
configuration. The pre-commit hook scans the staged tree. The commit-msg hook
rejects likely secrets and prohibited AI attribution trailers.

The compliance checker verifies:

- `origin` exists and the current branch is `main`;
- the worktree is clean;
- no forbidden or ignored runtime files are tracked;
- the staged tree and full history pass the secrets scan;
- one consistent commit author identity is used;
- no prohibited AI attribution trailers exist;
- tags are `level-NN`, `contest-start` or `pre-contest-final`;
- the README documents the latest level tag.

Findings print only the rule and file/object identifier, never the suspected
secret value. If a real secret is found in history, stop: do not rewrite
history or hide the finding; decide the remediation with the repository owner.

## Pre-push checklist

Run these checks before publishing task commits:

```bash
git status --short
git ls-files
node tools/rules-guard.js --staged
node tools/rules-guard.js --history origin/main..main
node tools/git-compliance-check
```

Only after all checks pass:

```bash
git push origin main
```

Use a plain push only. Never force-push, rewrite history, amend published
commits or change the configured author identity. If a push is rejected, stop
and inspect the redacted error instead of trying to bypass it.

Every push to `main` triggers Render's automatic deployment. Check the deploy
result and `https://YOUR_APP.onrender.com/health` after each push, and review
which backend changes went live.

## Evaluation tags

Tags mark the exact commit used for evaluation. The helper refuses a dirty tree
or a failed secrets guard, verifies the resulting commit, and never moves an
existing tag. It does not push tags.

### Contest start

Run only when the contest actually starts:

```bash
node tools/create-level-tag.js create contest-start
git push origin contest-start
```

### Level completion

Use two digits. From level 2 onward, first add the level to the README Levels
section and per-level changelog; the helper refuses to tag if it is missing.

```bash
node tools/create-level-tag.js create 03
node tools/create-level-tag.js verify 03
git push origin level-03
```

The verification output includes the exact commit hash to record in the level
write-up and contest tracker. Tag push commands above are manual team actions,
not automatic agent actions.

### Pre-contest marker

Create this only when the repository owner explicitly declares preparation
finished:

```bash
node tools/create-level-tag.js create pre-contest-final
git push origin pre-contest-final
```

Do not create this marker during ordinary preparation tasks.

## Judge repository access

Preferred private-repository option:

1. Keep the repository private.
2. Invite each judge or the contest's designated GitHub account as a
   collaborator with **Read** access.
3. Confirm the invitation is accepted before the evaluation.

Public-repository option: make the repository public only after the full
history passes the secrets and personal-data checks.

Before granting access, verify:

- the default branch is `main` and the intended commits are pushed;
- every required `level-NN`/`contest-start` tag points to the evaluated commit
  and has been pushed;
- `node tools/git-compliance-check` passes on a clean checkout;
- no secrets, face data, snapshots, database dumps, build output or runtime
  spool files exist in tracked files or history;
- the README and `docs/dependencies.md` accurately describe the submission.
