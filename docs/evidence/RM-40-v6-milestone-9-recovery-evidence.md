# RM-40 V6 · Milestone 9 — recovery implementation and closeout boundary

Prepared 6 September 2026. The engineering boundary was controlled-tested on
that date; the live deployment and recovery checks below were added on 7
September 2026. Revision 6 is still not ready to close.

## What changed

- `verifyControlPlaneBackup` validates the immutable manifest, safe relative
  paths, every file SHA-256, required control-plane stores, native-vault
  directory metadata and SQLite integrity before a restore begins.
- The production backup helper now checkpoints and stages a closed,
  whitelist-only native Hermes state set: conversation state, Kanban, cron
  executions, response/evidence/idempotency/project stores, session mapping
  and profile memory. Credentials, OAuth material, config, caches and logs
  never enter the snapshot.
- `restoreControlPlaneBackup` copies only manifest-listed files to a new,
  isolated destination and checks the restored SQLite files again. It never
  restores OAuth/credential files, starts a service or enables provider writes.
- The explicit `control-plane:restore` CLI requires `--live`, `--backup` and
  `--destination`; without all three it is a no-op. It reports counts and
  integrity status only, never file contents or secrets.
- Native-vault directory digests now use POSIX relative names, so a backup
  created during a Windows rehearsal has the same digest semantics as one
  created on the Linux Azure host.
- The existing backup manifest remains manifest-last for remote publication;
  a partial upload cannot be mistaken for a recoverable set.

## Controlled results

`test/system/control-plane-backup.system.test.ts`: **5/5 passed**, including:

1. native Hermes session/state inclusion;
2. per-file native-vault hashes and manifest-last upload order;
3. the native-state whitelist, SQLite checks and exclusion of auth material;
4. isolated restore with SQLite integrity checks for every restored store; and
5. tamper rejection before a destination directory is created.

Latest repository regression: **69 files, 814 passed, 2 intentionally skipped**,
exit 0. Typecheck, production build, deployment preflight, audit and diff
checks also exited 0.

## Live deployment and recovery verification · 7 September 2026

The approved V6 bundle is running on Malaysia West as
`real-ming:v6-23bd903`, with the native Hermes gateway, supervised native
dashboard and Real-Ming service active on loopback. The first backup start
failed before touching state because a Windows `git archive` emitted CRLF into
the helper shebang (`bash\r`, exit 127); `ExecStopPost` restored all services.
An LF-safe archive made with `git -c core.autocrlf=false archive` replaced the
helper, and commit `2c708f4` adds `.gitattributes` plus a regression test.

The corrected protected backup passed with generation
`2026-09-06T16-48-52.608Z`. Its manifest contained 12 files: the three
retained Real-Ming stores and the whitelisted Hermes native state/profile and
session files. No `auth.json`, `.env`, config, cache or log path was present.
The input was mounted read-only, copied into an ephemeral container tmpfs, and
the deployed restore CLI verified 12 files with 10 SQLite integrity checks at
an isolated destination. No live state, providers, schedules or credentials
were written.

## Live closeout still required

Ming must still complete the Malaysia restart/reconcile check, cost/usage and
retention review, and final baseline/readiness closeout. The previously
approved East Asia VM deallocation (stop/deallocate, never delete) remains a
separate final action; it is currently retained deallocated for rollback.

Milestone 9 is therefore **live-verified at the backup/isolated-restore
boundary, but not user-accepted or closed**.
