# Audit — Main Root vs `Initial/`

Date: 2026-11-13
Auditor: engineering pass for Levels 1–4
Scope: `D:\Hackathon Tahasan\fastrobox-smart-classroom-Forever_Knights` (main root)
Reference: `Initial/` (read-only snapshot; **not** a deployment target)

## 1. How this audit was performed

- Compared the committed baseline (`git show HEAD:<file>`), the working tree, and
  `Initial/` file-by-file (line counts, `diff -u`, behavioural reading).
- The main root is the single canonical project. `Initial/` is treated as a
  source of reviewable ideas and never as a runtime/deploy root.
- Nothing in `Initial/` was deleted, moved or modified.
- Existing uncommitted work in the main root was inspected before edits; no
  files were discarded or reset.

## 2. What each tree actually is

| Tree | Nature | Notable characteristics |
|------|--------|-------------------------|
| Main root `HEAD` ("basic") | Phase-1 foundation: ESP32 node + Express/PostgreSQL backend + dashboard | Dashboard guard is **optional** and fails open (`adminAuth` calls `next()` when `ADMIN_TOKEN` is unset); `GET /api/settings` is public; no rate limiter, no per-role users, no telemetry replay protection, no event service, dashboard is ~92 lines HTML / 253 lines JS |
| Main root working tree (this pass) | Level 1–4 implementation | Adds roles/RBAC, bcrypt + lockout, session tokens, telemetry/event services, SSE dashboard, fire/panic handling, notifications, firmware Level 1–3 rewrite, migrations 003–006, tests |
| `Initial/` | A more hardened **Phase-1** branch (task-2 checkpoint) | Per-device token lifecycle (issue/rotate/revoke, hash-only storage), `READ_TOKEN` protected reads, per-IP rate limiting, `docs/auth.md`, `backend/test/auth.test.js`, BOOT-hold provisioning, HTTPS CA validation, offline spool |

In short: `Initial/` is **ahead of root `HEAD` on Phase-1 access control**, but
**behind the working tree on Levels 2–4** (no users/roles, attendance identity,
fire/panic semantics, dashboard roles, firmware FreeRTOS/watchdog/alerts).

## 3. Findings by area

### 3.1 Backend access control

| Finding | Main root `HEAD` | `Initial/` | Decision in main root |
|---------|------------------|------------|-----------------------|
| Admin guard | Optional, fails **open** when `ADMIN_TOKEN` empty | Fails **closed** (503) and uses constant-time compare | **Merged** the fail-closed behaviour, then superseded by session/RBAC auth |
| Protected reads | Public | `READ_TOKEN` / `ADMIN_TOKEN` via headers | Superseded by authenticated sessions + role checks; legacy tokens retained for tooling only |
| Per-device tokens | Present but minimal | Issue/rotate/revoke, SHA-256 hash only, revoked check, bootstrap opt-in | **Merged** and extended with device health columns |
| Rate limiting | None | Per-IP fixed window for auth failures + writes | **Merged**, plus login lockout at the account level |
| Auth docs/tests | None | `docs/auth.md`, `test/auth.test.js` | Ported and rewritten as `docs/auth.md` + Level 4 tests |

### 3.2 Backend data model

| Finding | Detail | Decision |
|---------|--------|----------|
| `Initial/002_device_auth.sql` | Adds token lifecycle timestamps + unique token hash | Merged, **extended** with device health columns (`status`, `fire_latched`, `last_reset_reason`, `firmware`, `uptime_s`, `rssi`, `heap_kb`, `chip_temp_c`) |
| Root telemetry table | `(device_id, seq)` had **no** uniqueness constraint | Added `UNIQUE (device_id, seq)` + history indexes in `004_telemetry.sql` (idempotent) |
| Missing identity tables | No users/roles/cards/attendance/sessions/login history | Added `003_identity.sql`, `005_ops.sql`, `006_schedules.sql` (all idempotent, non-destructive) |
| Migration runner | Filename-ordered, transactional | Kept; extended with settings/room seeding |

### 3.3 Firmware

| Finding | `Initial/` | Decision in main root |
|---------|------------|-----------------------|
| HTTPS | `setCACert()` only, no insecure fallback; PEM from provisioning | Kept the policy, added a built-in public GTS Root R4 trust anchor so a factory-fresh device can reach the Render URL before a CA is provisioned |
| Provisioning | BOOT-hold only, AP `SmartClassroom-XXXX`, no password | Changed to automatic setup when Wi-Fi is missing **and** WPA2 password (`SmartClass-<TeamID>` + 8-char password printed on Serial), per Level 2 |
| Offline handling | Event spool + ordered resend | Kept, extended with durable telemetry sequence (`seq_high`) and BOOT/STATUS events |
| Task model | Single Arduino `loop()`-style modules | Replaced with FreeRTOS pinned tasks + per-task software watchdog (Level 1) |
| Safety state | Door/lock + thresholds inline | Centralised `state.cpp` (hysteresis, quality, trend, fire latch, panic) plus `alerts.cpp` priority LED/buzzer |
| RFID duplicates | Read loop without halt/cooldown | `PICC_HaltA()` + same-UID cooldown, one event per tap |
| Pin map | TODO placeholders | Kept placeholders, added panic touch pin with an explicit **verify-on-board** warning |

### 3.4 Frontend

| Finding | Main root `HEAD` | Decision |
|---------|------------------|----------|
| Auth | Optional admin token in `localStorage` | Replaced with login screen, session token in memory/sessionStorage, role-aware navigation |
| Roles | None | Admin / Teacher / Student / Guardian views added (Level 4) |
| Live data | Polling + SSE, some placeholder text | SSE live updates, explicit loading/empty/disconnected/error states, no simulated values |
| Safety UI | Basic status text | FIRE/PANIC banners, authorized Reset Fire / Silence controls, device health panel |
| i18n | English only | Full EN/BN switch for user-facing labels |
| Duplication | n/a | Same single frontend in `backend/public/` preserved and extended; no second app created |

### 3.5 Tooling, docs and compliance

- `tools/`, `tools/simulator/`, Git compliance and level-tag helpers exist in both
  trees and were **kept unchanged**.
- `Initial/` adds `docs/auth.md` and `test/auth.test.js`; both concepts were
  merged (new auth model documented in `docs/auth.md`; tests expanded in
  `backend/test/level4.test.js`).
- No fake level tags, no fake test artefacts and no fabricated deployment
  evidence were created.

## 4. Deliberate divergences from `Initial/`

1. **Provisioning is automatic**, not BOOT-hold-gated, because Level 2 requires
   returning to setup within 15 s after unrecoverable Wi-Fi failure and open
   setup on first boot. A BOOT hold at reset still wipes Wi-Fi.
2. **Setup AP is WPA2-protected** with a generated 8-character password, rather
   than open. This is stricter than `Initial/`.
3. **`ADMIN_TOKEN`/`READ_TOKEN` are no longer the primary dashboard auth path.**
   They remain supported for scripts/judges, but every protected route is now
   authorised by server-side role checks on a session token.
4. **Firmware uses a built-in public root CA** to avoid a chicken-and-egg
   provisioning problem; provisioning can override it with a PEM in NVS.

## 5. Risks carried forward

- GPIO assignments remain **placeholders** in `firmware/src/pins.h`; they must be
  verified against the actual ESP32-S3-CAM variant before wiring.
- No physical sensor/RFID/buzzer/LED/door tests have been executed in this
  environment. All hardware-dependent claims are marked as pending.
- Notification delivery depends on provider credentials (Telegram/email/webhook);
  when absent, the backend logs a clear "not configured" outcome and never
  reports success.
