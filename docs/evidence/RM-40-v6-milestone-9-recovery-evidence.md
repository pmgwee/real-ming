# RM-40 V6 · Milestone 9 — recovery implementation and closeout boundary

Prepared 6 September 2026. This records the engineering portion of recovery
work. It does not claim that a post-conversation Azure backup has been restored
or that Revision 6 is ready to close.

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

Latest repository regression: **69 files, 813 passed, 2 intentionally skipped**,
exit 0. Typecheck, production build, deployment preflight, audit and diff
checks also exited 0.

## Live closeout still required

Ming must still run the protected backup after the first accepted native
conversation so Hermes native state and the native vault are present, inspect
the manifest without exposing secrets, and restore it to an isolated
destination with providers, delivery and schedules disabled. The Malaysia
restart/reconcile check, cost/usage and retention review, baseline/readiness
update, and the previously approved East Asia VM deallocation
(stop/deallocate, never delete) remain separate acceptance actions.

Milestone 9 is therefore **implemented at the recovery boundary and
controlled-tested, but not live-verified, user-accepted or closed**.
