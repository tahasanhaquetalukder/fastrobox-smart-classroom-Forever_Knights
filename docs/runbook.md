# Contest runbook

This runbook is for team **Forever_Knights**. Keep secrets in environment
variables or device NVS only. Never put real credentials, database connection
strings, face data, snapshots or firmware binaries in Git.

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
