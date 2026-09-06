# RM-40 V6 · Malaysia West deployment evidence

Prepared 7 September 2026 (Asia/Kuala_Lumpur) after the approved Decision 1
deployment. This records production wiring and recovery checks; it does not
turn the remaining CEO acceptance gates into completed milestones.

## Deployment identity

- Host: `real-ming-control-plane-my` (Malaysia West), private Tailscale access
  only. The East Asia VM remains deallocated and undeleted for rollback.
- Source: commit `23bd90392ffcff7798ec3602ff2f0fc0de6d16bb`.
- Real-Ming image: `real-ming:v6-23bd903`.
- Image ID: `sha256:388f0de13fbf4d313f78fa36b32fa62248bf3fe059ccfc05561e2b26b9f630f0`.
- Native Hermes v0.21.0 remains pinned to
  `561b053f794a1781868bb032029d589c67708119`.
- Native Hermes owns Telegram; Real-Ming is in `native-hermes-gateway` mode
  and polls no updates. Native cron remains disabled with zero jobs, and
  `memory.write_approval` remains `false` pending its separate CEO decision.

## Live verification

The approved cutover installed and enabled the supervised units:

| Check | Result |
| --- | --- |
| `hermes.service` | active and enabled |
| `hermes-dashboard.service` | active and enabled |
| `real-ming.service` | active and enabled |
| `real-ming-backup.timer` | active and enabled |
| Hermes health (`127.0.0.1:8642/health`) | HTTP 200 |
| Native Hermes dashboard (`127.0.0.1:9119/sessions`) | HTTP 200 |
| Real-Ming dashboard without bearer (`127.0.0.1:8787/sessions`) | HTTP 401 |
| Listener binding | `127.0.0.1` only for ports 8642, 8787 and 9119 |
| Hermes model/provider | `gpt-5.6-sol` / `openai-codex` |
| Real-Ming MCP extension | enabled in Hermes |
| Native cron | healthy ticker, no active jobs |
| Control-plane live smoke | passed, exit 0 |

No Telegram message, Notion write, scheduled delivery or memory write was
created by this deployment verification.

## Backup and isolated restore

The first backup attempt exposed a packaging defect: a plain Windows
`git archive` under `core.autocrlf=true` emitted CRLF into the Linux helper
shebang (`bash\r`) and systemd returned exit 127. Services were restored by
`ExecStopPost`; no state was lost. The helper was then installed from an
LF-safe archive made with `git -c core.autocrlf=false archive`. Commit
`2c708f4` adds `.gitattributes` and a regression test so Linux deployment
artifacts stay LF-delimited.

The corrected protected backup passed and produced generation
`2026-09-06T16-48-52.608Z`:

- 12 manifest-listed files were present, including 9 native Hermes state or
  profile/session files plus the three retained Real-Ming stores.
- No `auth.json`, `.env`, config, cache or log path was present.
- The backup input was mounted read-only for restore verification, copied into
  ephemeral container tmpfs, and restored to `/tmp/recovered`.
- The isolated restore verified 12 files and 10 SQLite integrity checks, with
  no write to live state, providers, schedules or credentials.

## Acceptance boundary still open

- **Milestone 5:** native cron job creation, one-run/restart duplicate check
  and ownership cutover remain a separate CEO-approved live action.
- **Milestone 6:** native note/recall, restart recall and the memory-write
  approval decision remain pending; the recovery set now includes the native
  stores that exist.
- **Milestone 7:** the native dashboard is now supervised and live on loopback;
  the authenticated Real-Ming comparison and CEO outcomes review remain.
- **Milestone 8:** live user acceptance for coding, provider/source coverage,
  scheduling, dashboard and recovery remains.
- **Milestone 9:** backup and isolated restore are live-verified; the
  Malaysia restart/reconcile check, retention/cost review and final closeout
  remain before the East Asia rollback VM can be retired.
