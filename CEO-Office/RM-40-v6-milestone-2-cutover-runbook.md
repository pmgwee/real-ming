# RM-40 · Milestone 2 — reversible one-owner Telegram cutover

Prepared 6 September 2026. **Nothing in this document has been executed.** It
is the rehearsed procedure and its rollback, ready for the CEO decision that
milestone 3 requires.

## TL;DR

Telegram permits one reliable polling owner. Architecture Revision 6 moves that
owner from the Real-Ming ingress process to the native Hermes gateway. The
invariant does not relax — only its owner changes.

The composition change is done and proven in controlled tests: Real-Ming can
now run with `REAL_MING_TELEGRAM_OWNERSHIP=native-hermes-gateway`, in which it
polls nothing, interprets nothing, holds no Hermes conversation, and still runs
its schedules, records and dashboard. The default is unchanged, so today's
deployed behaviour is untouched until someone sets that variable.

**Two things must be true before the cutover is safe, and one of them is not
true yet:** the native gateway needs an explicit model/provider (the host
default points at a provider it has no credential for), and the native Telegram
platform needs configuring. Both are engineering steps inside milestone 3.

## Why this cannot be delegated

- Stopping the current consumer and starting another on the same bot is an
  outward-facing change to Ming's only remote command surface. If it is wrong,
  Ming's messages stop arriving.
- The Revision 5 approved image digest is **not** approval for a Revision 6
  artifact. A new candidate needs its own review and its own decision.
- The window matters: during the swap there is a period with no consumer, and
  Telegram queues updates rather than losing them, but only for a bounded time.

## What changed in the code

| File | Change |
| --- | --- |
| `src/runtime/control-plane-supervisor.ts` | `pollTelegram` is now optional. When omitted the ingress loop reports `stopped`, which is deliberately distinct from `failed` — a health record claiming a failed ingress would page Ming about a migration that worked. |
| `src/runtime/daily-operations-control-plane.ts` | New `telegramOwnership` mode, defaulting to `real-ming-ingress`. In `native-hermes-gateway` mode no poller is started and the Hermes turn coordinator is not constructed, so the mandatory JSON turn envelope has no path. Delivery recovery was extracted out of the polling loop so outbound notifications keep an owner after the consumer is handed away. |
| `src/runtime/production-control-plane.ts` | Reads `REAL_MING_TELEGRAM_OWNERSHIP`. An unrecognised value **refuses to start** rather than defaulting, because a typo there would silently start a second consumer — the exact failure this migration exists to avoid. |
| `src/testing/real-ming-system-harness.ts` | The seam exposes the mode so scenarios can assert it. No third test seam was introduced. |
| `test/system/native-gateway-composition.system.test.ts` | Five scenarios covering the rehearsal below. |

`npm run check`: 776 passed, 2 skipped, exit 0. `npm audit --audit-level=high`:
0 vulnerabilities. `git diff --check`: exit 0.

## Rehearsal already passed, in controlled tests

| Scenario | Result |
| --- | --- |
| Native mode starts no Telegram poller | Zero poll requests; cycle reports `stopped`, not `failed`; a queued `/do` command creates no Work Item and receives no reply |
| Native mode does not reinterpret role-prefixed chat | A queued `CTO: explain this stack trace` creates no Work Item and produces no reply. The 5 September legacy-parser bypass cannot recur, because there is no ingress to bypass into |
| Retained operations survive losing the transport | Schedules tick, the dashboard serves, the deployment smoke passes, all without owning Telegram |
| No conversation is proxied | With the Hermes edge enabled, `hermesOverview()` is `undefined` and no Hermes answer is delivered by Real-Ming — two systems cannot claim one session |
| The default is untouched | Without the variable, ownership is `real-ming-ingress`, polling runs and the `/do` command still becomes a Captured Work Item |

These prove the composition. They do **not** prove the live swap; that is what
the procedure below is for.

## Ownership after cutover — read this before assuming

| Concern | Owner before | Owner after this cutover | Owner at milestone 5 |
| --- | --- | --- | --- |
| Telegram consumer (`getUpdates`) | Real-Ming ingress | **Native Hermes gateway** | Native Hermes gateway |
| Conversation, tools, coding, final answer | Real-Ming turn coordinator wrapping Hermes | **Native Hermes agent loop** | Native Hermes agent loop |
| Scheduled brief and roll-up delivery | Real-Ming | **Still Real-Ming** | Native cron — switched deliberately |
| Durable Work Items, approvals, audit, portfolio | Real-Ming | Real-Ming | Real-Ming, reached as a tool |

The third row is the one people get wrong. Scheduled delivery is an *outbound*
concern and does not conflict with the single-consumer rule, so Real-Ming keeps
sending the 07:30 brief and 21:30 roll-up after cutover. Stopping it here would
lose Ming his briefs, since native cron has no jobs configured yet — the live
host shows zero. Duplicate briefings only become possible when milestone 5 adds
a native job, and that is when the owner switches, in one step, with the
Real-Ming schedule disabled in the same change.

## Blockers that must clear first

1. **Native default model.** The host's `config.yaml` sets
   `model.default: anthropic/claude-opus-4.6` over OpenRouter, while the only
   pooled credential is `openai-codex`. The Revision 5 bridge hides this by
   overriding model and provider on every call. The native gateway supplies no
   such override, so a native session would start on a provider the host is not
   authenticated for. Set it explicitly to `gpt-5.6-sol` / `openai-codex`
   through protected configuration before any native Telegram traffic.
2. **Native Telegram platform.** `gateway:` in `config.yaml` is empty and the
   only connected platform is `api_server`. The platform must be configured
   with the existing protected bot credential and Ming's allowlisted numeric
   identity through the secret mechanism — never on a command line, in a
   screenshot, in a prompt or in evidence.

## Cutover procedure

Run on the Malaysia host over the existing private Tailscale path. No public
port is opened at any point.

1. **Checkpoint.** Take a fresh state backup and record its generation id and
   restore evidence. Confirm no Work Item is mid-flight.
2. **Record the current Telegram offset.** The ingress cursor is durable in
   `state.sqlite`. Note it; the reverse procedure needs it.
3. **Stop the old consumer.** Stop `real-ming.service`. Confirm the container
   is gone and no process holds the bot's `getUpdates`.
4. **Verify it stopped.** Zero Real-Ming poll requests for a full minute.
   A cutover that starts the second consumer before the first is gone is the
   one thing this ordering exists to prevent.
5. **Set the native model and platform.** Apply the two blockers above through
   protected configuration.
6. **Start the native gateway on Telegram.** Restart `hermes.service` and
   confirm `gateway_state.json` lists a connected `telegram` platform alongside
   `api_server`.
7. **Restart Real-Ming in native mode.** Set
   `REAL_MING_TELEGRAM_OWNERSHIP=native-hermes-gateway` in
   `/etc/real-ming/release.env` and start `real-ming.service`. Confirm the
   dashboard reports the ingress as stopped rather than failed.
8. **Verify one owner.** Exactly one process consumes updates. Correlate one
   allowed incoming message to a native session id without logging its content.
9. **Run the phone matrix** in the implementation plan's milestone 3 table.

## Reverse procedure

Stop the native consumer **first**. The ordering is not symmetric, and reversing
it creates the double-consumer state the whole procedure avoids.

1. Stop `hermes.service`'s Telegram platform (or the service) and verify it is
   no longer consuming.
2. Reconcile: any message answered natively after cutover exists only in the
   native session store. Export it before restoring, or that conversation is
   lost from Real-Ming's record.
3. Remove `REAL_MING_TELEGRAM_OWNERSHIP` from `/etc/real-ming/release.env`
   (or set it to `real-ming-ingress`) and restart `real-ming.service`.
4. Confirm the ingress cursor resumes from step 2's recorded offset and that no
   already-answered message is replayed.
5. **Preserve records created after cutover.** Merely restarting the old VM
   loses or duplicates intervening work. Rolling back the process is not the
   same as rolling back the data.

## Extension interface — verified, not assumed

Milestone 5 needs Real-Ming to expose task/record operations as tools the agent
can call. Both candidate routes were checked against the installed v0.21.0
rather than assumed:

| Route | Verified interface | Disposition |
| --- | --- | --- |
| **MCP server** | `hermes mcp add <name> --command <cmd> --args … --env KEY=VALUE`, with `list`, `test`, `configure`, `remove`. Zero servers configured today. | **Recommended.** Real-Ming stays TypeScript in its own process, uses a supported versioned interface, and `--env` keeps credentials out of prompts and command lines. |
| **Native plugin** | Python packages under the Hermes tree, validated by `hermes plugins doctor --ci`; bundled examples carry a `dashboard/` directory. All bundled plugins currently show `not enabled`. | Defer. It would put Real-Ming logic inside the Hermes install in a second language. The `dashboard/` convention is useful evidence for milestone 7's CEO view. |

No package was created under `integrations/hermes/`. That location remains a
proposal until milestone 5 chooses a structure against this evidence.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Real-Ming refuses to start after editing `release.env` | `REAL_MING_TELEGRAM_OWNERSHIP` has a typo | The refusal is deliberate. Correct the value to `real-ming-ingress` or `native-hermes-gateway` |
| Dashboard shows the ingress as `failed` after cutover | The variable was not applied, so Real-Ming is still trying to poll a bot the gateway now owns | Confirm the value reached the container environment, then restart |
| Ming's message reaches nothing | Both consumers stopped, or the native platform did not connect | Check `gateway_state.json` for a connected `telegram` platform; Telegram queues updates for a bounded period, so a prompt fix loses nothing |
| Two replies to one message | Both consumers are running | Stop the Real-Ming consumer immediately; this is the state step 4 exists to prevent |
| No 07:30 brief after cutover | Real-Ming was stopped rather than restarted in native mode | Scheduled delivery is still Real-Ming's until milestone 5. Restart it in native mode |
| Native session starts and immediately errors | The default model blocker was not cleared | Set `gpt-5.6-sol` / `openai-codex` explicitly through protected configuration |

## What is still not proven

- The live swap itself. Everything above is controlled-test evidence plus a
  written procedure.
- Native Telegram presentation, commands, progress and attachments. Untested by
  design; it needs an authorized bot.
- Gateway session continuity. Milestone 1 proved the one-shot CLI path does
  **not** resume, so continuity must be tested on the gateway path and cannot
  be inferred.
- The Revision 6 deployment artifact. No image has been built for this change.
