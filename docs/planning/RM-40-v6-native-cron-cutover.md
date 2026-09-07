# RM-40 V6 · Native Hermes cron cutover

This is the engineering procedure for the scheduler-ownership slice. It is
not a permission to send new Telegram messages. Use the CEO action queue before
the first live `hermes cron run` or any change to the protected service files.

## Contract

- Hermes native cron owns exactly two triggers and deliveries: 07:30 and 21:30
  in `Asia/Kuala_Lumpur`.
- Real-Ming retains the Morning Brief and Executive Roll-Up builders and their
  source semantics. It exposes one MCP operation,
  `real_ming_run_scheduled_report`, which returns a bounded, replayable
  evidence artifact.
- Hermes uses that artifact to compose the final Telegram response in its own
  voice. The native Telegram gateway delivers it; Real-Ming never calls
  `sendMessage` for these reports.
- The old in-process scheduler remains enabled until both native jobs exist and
  pass a deliberate run/restart check. This is the rollback guard.

## Preflight (read-only)

Run on the Malaysia host as `real-ming`:

```bash
hermes --version
hermes status --all
hermes mcp test real-ming
hermes cron status
hermes cron list --all
hermes cron doctor
```

`hermes mcp test real-ming` must show
`real_ming_run_scheduled_report` in addition to the three existing tools. Do
not proceed if the extension is not connected or if another job already owns
either name.

The repository-safe manifest is available with:

```bash
npm run native-cron:manifest
```

It contains no Telegram chat id or secret. The destination is supplied from
Hermes's protected configuration (`telegram:<CEO_CHAT_ID>`), never committed
to this repository.

## Stage the jobs

Use the exact prompts from the manifest. The CLI syntax below is the installed
Hermes interface; replace `<CEO_CHAT_ID>` only in the shell's protected local
session and never paste the value into an issue, prompt or evidence file.

```bash
hermes cron create '30 7 * * *' '<MORNING_PROMPT>' \
  --name 'Real-Ming Morning Brief' \
  --deliver 'telegram:<CEO_CHAT_ID>' \
  --model gpt-5.6-sol --provider openai-codex

hermes cron create '30 21 * * *' '<ROLLUP_PROMPT>' \
  --name 'Real-Ming Executive Roll-Up' \
  --deliver 'telegram:<CEO_CHAT_ID>' \
  --model gpt-5.6-sol --provider openai-codex
```

Pin the job model/provider so a later global model change cannot silently alter
unattended cost or behaviour. Set `cron.wrap_response=false` in the Hermes
profile so the native response is not wrapped in a second cron header/footer.

**Timezone — corrected 7 September 2026.** An earlier version of this procedure
said the *host* must use `Asia/Kuala_Lumpur`, confirmed with `timedatectl`.
That is wrong and following it would have rewritten every host log timestamp
for no reason. `hermes_time.now()` resolves in this order:

1. the `HERMES_TIMEZONE` environment variable,
2. the top-level `timezone` key in the Hermes profile config,
3. the server's local time.

The host is deliberately `Etc/UTC` and stays that way. What must be set is the
Hermes profile:

```bash
hermes config set timezone Asia/Kuala_Lumpur
```

This was applied on 7 September while zero cron jobs existed, so nothing
rescheduled. Verified: `hermes_time.now()` returns `+08:00`.

Had this been missed, `30 7 * * *` would have fired at 07:30 **UTC** — 15:30 in
Kuala Lumpur — and the morning brief would have arrived mid-afternoon. Confirm
the offset before creating either job:

```bash
hermes config get timezone
```

If a job with the same name already exists, edit it instead of creating a
duplicate:

```bash
hermes cron edit '<JOB_ID>' --schedule '30 7 * * *' \
  --prompt '<MORNING_PROMPT>' --deliver 'telegram:<CEO_CHAT_ID>' \
  --model gpt-5.6-sol --provider openai-codex
```

## Controlled live verification

1. Keep `REAL_MING_SCHEDULER_OWNERSHIP=real-ming` and
   `REAL_MING_NATIVE_CRON_ENABLED=false` while staging.
2. Trigger one job with `hermes cron run '<JOB_ID>'`. Verify the agent calls
   the MCP operation once, presents a concise focus-first Telegram message
   (source warnings, decisions/blockers, bounded next steps and no backlog
   dump), and the Real-Ming scheduler row records the old owner (the old
   scheduler is still the production owner at this point).
3. Stop and restart `hermes.service` once. Run `hermes cron runs '<JOB_ID>'`
   and `hermes cron doctor`; an already-completed attempt must not be rerun by
   the restart. Do not manually run the second job until the first check is
   recorded.
4. Verify the Real-Ming dashboard's scheduler rows show the configured owner,
   last run id and next Kuala Lumpur run. The dashboard must not render report
   text or any credential.

## Ownership switch and rollback

After both jobs pass the previous section, and only after the CEO action is
confirmed:

```bash
# /etc/real-ming/release.env
REAL_MING_SCHEDULER_OWNERSHIP=native-hermes-cron
REAL_MING_NATIVE_CRON_ENABLED=true

# /etc/real-ming/hermes.env (preserve API_SERVER_KEY; change only this flag)
REAL_MING_NATIVE_CRON_ENABLED=true

sudo systemctl restart hermes.service real-ming.service
```

Confirm `hermes cron list`, `hermes cron doctor`, `hermes cron runs`, and the
Real-Ming dashboard. The Real-Ming scheduler's active run set must no longer
claim the two native-owned jobs; its durable rows remain as migration history.
The next scheduled day must produce one message per job and a native success
plus delivery record.

Rollback is reversible: pause the two native jobs, set both ownership flags
back to `real-ming`/`false`, restart `real-ming.service`, and verify the old
scheduler resumes from its durable occurrence ledger. Do not delete the jobs or
the old VM until the first native scheduled day has passed and its backup is
verified.
