# RM-40 V6 · Milestone 5 scheduler-ownership evidence

Executed 6 September 2026 in the local System Harness. This is controlled
engineering evidence; it is not evidence that the native cron jobs have been
enabled on the Malaysia host.

## Build-alignment checkpoint

| Checkpoint | Decision |
| --- | --- |
| Product contract | Real-Ming keeps composing the 07:30 Morning Brief and 21:30 Executive Roll-Up from its existing source/state semantics. Native Hermes owns the trigger, session and Telegram delivery. |
| Capability disposition | Native Hermes cron → configured job prompts and Telegram delivery → existing Real-Ming composers through one MCP operation → custom loopback endpoint only as the transport seam between the Hermes MCP process and the running control plane. |
| Ownership | `morning-brief` and `executive-roll-up` are marked `native-hermes-cron`; the old in-process scheduler excludes them only when `REAL_MING_SCHEDULER_OWNERSHIP=native-hermes-cron`. The default remains `real-ming` until jobs are staged and verified. |
| Traceability | Each occurrence is keyed by Kuala Lumpur operating date. The SQLite scheduler row records owner and run id; a separate append-only output record stores the exact report text and SHA-256 digest for replay. |
| Evidence states | Controlled tests prove composition, replay, migration skip, date validation and no Telegram call. Live configured-job, delivery and restart evidence remains pending. |
| Next demonstrable slice | Stage the two Hermes cron jobs with the safe manifest, dry-run them against the loopback endpoint, then perform one deliberate disable/enable cutover and verify native `hermes cron runs` plus the Real-Ming dashboard owner/run fields. |

## What changed

- `MorningBriefComposer` and `ExecutiveRollUpComposer` separate domain
  composition from admission/delivery. Existing Real-Ming runners remain for
  the rollback/default scheduler path.
- `NativeScheduledReportService` claims the durable occurrence, composes via
  the existing builders, records owner/run id and an append-only replayable
  payload, and returns text without sending Telegram.
- `POST /internal/native-cron/run` is a loopback-authenticated endpoint using
  the existing Hermes bridge key. It is not part of the CEO dashboard and does
  not accept dashboard cookies.
- The `real_ming_run_scheduled_report` MCP operation is exposed only when
  `REAL_MING_NATIVE_CRON_ENABLED=true`. The MCP process uses `API_SERVER_KEY`
  inherited from Hermes; no secret is written to the repository or prompt.
- `npm run native-cron:manifest` emits the schedule and self-contained prompts
  without a chat id or credential. The host is staged with
  `REAL_MING_SCHEDULER_OWNERSHIP=real-ming` and native cron disabled until the
  operator performs the cutover.

## Controlled results

`npm run check` — exit 0; 69 test files, 813 passed, 2 skipped; deployment
preflight passed. `npm audit --audit-level=high` — exit 0, 0 vulnerabilities.
The required dashboard browser check passed with Chromium outside the sandbox.

The native-cron system scenarios prove:

1. a brief is composed through the existing builder and replay returns the exact
   same text/digest without a Telegram send;
2. an occurrence already completed by the previous Real-Ming owner is skipped,
   so enabling native cron cannot duplicate that day's delivery; and
3. a request for another Kuala Lumpur operating date is rejected.

## Live acceptance still required

No live job was created, run, paused or resumed by this change. Creating or
triggering a Telegram-delivering cron job is a new outward action. The operator
must use the CEO action queue to:

1. confirm the native `real-ming` MCP server exposes the fourth scheduled-report
   tool after the new image is deployed;
2. create or edit exactly two native jobs from the manifest, pinning the
   `openai-codex` / `gpt-5.6-sol` profile and the CEO's protected Telegram
   destination;
3. run each once deliberately, inspect the native execution history and the
   Real-Ming dashboard, and verify Kuala Lumpur local time, one message and no
   duplicate after a gateway restart;
4. only then set `REAL_MING_SCHEDULER_OWNERSHIP=native-hermes-cron` and
   `REAL_MING_NATIVE_CRON_ENABLED=true`, restart the control-plane service, and
   confirm the old scheduler reports those jobs as absent from its active run
   set; and
5. retain the old state/image for rollback until the first scheduled day has
   a native success and delivery record.
