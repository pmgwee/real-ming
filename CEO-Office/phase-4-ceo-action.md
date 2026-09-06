# Phase 4 CEO actions

> **Current next step · 6 September 2026:** Engineering follows [the V6 native-first implementation plan](../docs/planning/RM-40-v6-native-first-implementation-plan.md). Its final CEO-action table distinguishes access, product choices and acceptance from implementation work. The checks below describe the recorded V5 activation; repeat phone acceptance after the native candidate is ready. No new login requirement has been established by the plan.

## ✅ CLEARED — and now one test only you can run · 6 September 2026

You stopped the East Asia VM and it worked. The native Hermes gateway is now the
single Telegram consumer for your bot, and it registered 60 native commands in
the bot menu. Full verification is in
[milestone 3 cutover evidence](../docs/evidence/RM-40-v6-milestone-3-cutover-evidence.md).

**Leave the East Asia VM stopped but undeleted.** It is your rollback until you
accept Revision 6. Nothing to do in Tailscale — the device goes offline on its
own and rejoins automatically if you ever restart the VM.

### The phone test

Open Telegram, message the bot, and tell me what you see. This is the milestone 3
pass criterion and I cannot produce it — I have no Telegram account.

| Send this | What should happen |
| --- | --- |
| "Hi, what can you help me with?" | A natural reply. No role announced, no task created |
| A short follow-up about that answer | It remembers the previous message — user-observed and passed with the Blue Lantern/November recall check |
| `/help`, then look at the command menu | Native commands, including the 60 now registered |
| "Explain async/await with a short code example" | Readable formatting and a proper code block — the thing that was broken before |
| "As CTO, what's the release path for a DuitSini change?" | The release rules, interpreted by the agent — not a canned parser reply |
| Something that takes a few steps | A typing indicator or progress, then an accurate result — staged progress/tool activity is now user-observed and passed |
| Send a photo or file | Handled, or a clear message if that type is unsupported — screenshot handling is now user-observed and passed |

Tell me anything that looks wrong, however small. Presentation defects are
exactly what the last smoke test missed.

## Where engineering stopped · 6 September 2026

Milestones 0, 1 and 2 are complete and needed no action from you. Codex OAuth
and Tailscale were re-confirmed healthy at 03:14 UTC — **do not sign in again**.

Milestone 3 executed under your approval. The Malaysia side is complete: Real-Ming
runs the Revision 6 image and no longer polls Telegram, and the native Hermes
gateway holds your bot credential and allowlist. Two defects from earlier
milestones are fixed and verified, and a third — found only by deploying for
real — is fixed with a build check that stops it recurring.

Two decisions remain open. Neither blocks engineering; the East Asia VM above does.

| # | Decision | What I need | My recommendation |
| --- | --- | --- | --- |
| 1 | **RM-40 (#41) acceptance criteria** | A yes before I post an issue comment. The open readiness ticket is written for Revision 5 and contains no criterion for native Telegram ownership, native presentation, a real coding loop or native memory. Passing it as written would repeat exactly the drift we just documented. Exact proposed wording is in [the requirement ledger §6](../docs/planning/RM-40-v6-requirement-ledger.md). **Nothing has been written to GitHub.** | Approve. Keep all six existing criteria as the controlled-test floor and add the five native-experience criteria on top. |
| 1b | **GitHub and Vercel read tokens** | Neither `real-ming-github-read-token` nor `real-ming-vercel-read-token` exists in Key Vault, so the code and deployment lineage views have been running against no credential rather than failing loudly. Scoped read-only tokens, stored in Key Vault, switch on work that is already built and tested. | Provide them when convenient. Nothing else is waiting on it, and read-only scope keeps the blast radius at zero. |
| 1c | **Should the agent browse Notion directly?** | Today it cannot. Your existing Notion token also grants *write*, and handing that over would let the agent write Master Tasks rows without the status semantics and duplicate-protection Real-Ming exists to enforce. A second, read-only Notion integration shared to the pages you want visible would give free lookup with no risk. | Create the read-only integration. "Look it up in my notes" is genuinely useful, and a read-only token is trivial to revoke. |
| 2 | **Optional curated-knowledge guarantees** | A direction, not an urgent answer. Versioned atomic publication, contradiction quarantine and access-controlled cross-domain projection are built and controlled-tested but were never wired to a production caller. Revision 6 makes them optional rather than default. | Defer. Prove native Obsidian/LLM-Wiki knowledge works in milestone 6 first, then decide against real observed gaps. The code and design are preserved either way. |
| 3 | **Telegram cutover window** — *executed 6 Sep under your approval; superseded by the East Asia action above* | A window when a short gap in Telegram replies is acceptable. The swap stops the Real-Ming consumer, starts the native Hermes gateway on the same bot, and is reversible. The full procedure, its reverse, the ownership table and the troubleshooting list are in [the cutover runbook](../docs/evidence/RM-40-v6-milestone-2-cutover-runbook.md). | Pick a quiet window. Two engineering steps clear first — setting the native model explicitly and configuring the native Telegram platform — and I will do those in the same session. Telegram queues updates during the gap rather than losing them. A Revision 6 deployment artifact, if one turns out to be needed, will come to you separately; the Revision 5 approved digest is not approval for it. |

**What changed on 6 September.** The specification, ADRs, baseline labels and
tests are reconciled to Architecture Revision 6 ([ADR-0020](../docs/adr/0020-run-ming-on-the-native-hermes-runtime.md)),
and every Revision 5 requirement now carries an explicit keep/revise/defer/remove
disposition. Native Hermes was proven to perform a real coding loop on a
disposable fixture — 15 native tool calls, a real diff, an independently
verified test exit status of 0; two defects in the installed version's scripted
interface were found and recorded
([milestone 1 evidence](../docs/evidence/RM-40-v6-milestone-1-native-runtime-evidence.md)).
Real-Ming can now run without owning Telegram, proven by five System Harness
scenarios, with the cutover and its reverse written out
([milestone 2 runbook](../docs/evidence/RM-40-v6-milestone-2-cutover-runbook.md)).

No production service, credential, network rule or Telegram setting was changed.

## TL;DR

The Malaysia West Phase 4 candidate is active and is now the only Telegram
polling owner. Codex OAuth and Tailscale enrollment are complete. Ming supplied
the first Telegram smoke results: real Hermes answers arrived, but the expected
Telegram experience and complete coding workflow are not ready. Developer
corrections come next; see [Telegram smoke findings](../docs/evidence/RM-40-phase4-telegram-smoke-findings.md).
Backup/restore proof and final East Asia deallocation remain outstanding.

Repeat **section 3** after the corrections are ready. Do not repeat the
identity steps unless the corresponding credential or device is unhealthy.

Do not paste any OAuth token, Telegram token, dashboard token, Key Vault
secret or Tailscale credential into Codex, Telegram, GitHub or this file.

## Current safe checkpoint

| Item | State |
| --- | --- |
| Malaysia West VM `real-ming-control-plane-my` | Active candidate; Hermes and Real-Ming services healthy |
| Reviewed Real-Ming image | Exact approved digest restored and verified |
| Hermes | v0.21.0 at the pinned commit; Codex OAuth authorized; loopback API healthy |
| Real-Ming on Malaysia West | Active; exact approved image; loopback dashboard only |
| Real-Ming on East Asia | Stopped for cutover; keep the VM for rollback until final proof |
| Hermes bridge key | Stored in Azure Key Vault and protected host configuration; value never displayed |
| Backup | Singapore storage generation restored and SQLite-verified |
| Obsidian | CEO-only destination configured; production Knowledge Operations wiring is missing; no sync enabled |
| Tailscale | Malaysia device enrolled; private address verified; SSH tunnel and dashboard smoke passed |
| Network | No public SSH, Hermes or dashboard inbound rule |

The complete technical sequence and rollback plan remain in
[RM-40-phase4-activation-runbook.md](RM-40-phase4-activation-runbook.md).

## 7. Native Hermes scheduled reports — pending CEO cutover

The repository now separates report composition from scheduling and delivery.
Real-Ming still composes the 07:30 Morning Brief and 21:30 Executive Roll-Up;
native Hermes cron will trigger them and deliver the exact returned text through
the already-connected native Telegram gateway. No live cron job has been
created or run by the implementation work.

**Latest live preflight (6 September):** the native cron ticker is healthy but
has zero jobs; the deployed `real-ming` MCP server still exposes three tools,
not the staged scheduled-report tool; and the protected release files do not
yet contain the native-cron flags. This is the expected safe staged state, not
a failed Telegram gateway.

Ming must perform the live cutover because it creates Telegram-delivering
scheduled jobs and changes the production owner. Follow the engineering
[native cron cutover procedure](../docs/planning/RM-40-v6-native-cron-cutover.md)
after the new image is deployed. The procedure includes the read-only
preflight, exact manifest, one-run/restart verification, ownership switch and
rollback.

Before switching ownership, confirm all of the following personally:

- exactly two native jobs exist, in `Asia/Kuala_Lumpur`, addressed to the
  protected CEO Telegram destination;
- each job calls the fourth `real-ming_run_scheduled_report` MCP operation and
  returns the builder's readable text without a cron wrapper;
- one deliberate run per job appears in both Hermes history and the private
  dashboard, with no duplicate after a Hermes restart; and
- only after that verification, the two protected ownership flags are changed
  to `native-hermes-cron`/`true` and the services are restarted.

Do not paste the Telegram chat id, bridge key or any provider credential into
this file, an issue, a prompt or the evidence bundle. Keep the old scheduler
enabled until the cutover procedure reaches its explicit switch step.

## 8. Native Hermes memory and Obsidian acceptance — pending CEO checks

Engineering has prepared the native configuration and recovery wiring. Review
the secret-free [configuration fragment](../hermes/config.native-first.example.yaml)
and [milestone 6 evidence](../docs/evidence/RM-40-v6-milestone-6-native-memory-evidence.md).
The live preflight confirms native memory and the user profile are enabled;
`memory.write_approval` is still `false`, so no persistent memory write should
be treated as accepted until you deliberately apply the setting below.
The commands below change only Hermes' non-secret settings; run them as the
`real-ming` service account on Malaysia after the current gateway is healthy:

```bash
hermes config set memory.memory_enabled true
hermes config set memory.user_profile_enabled true
hermes config set memory.memory_char_limit 2200
hermes config set memory.user_char_limit 1375
hermes config set memory.write_approval true
hermes config check
```

Then confirm the native `obsidian` and `llm-wiki` skills, create one small
source-cited note, retrieve it in a follow-up Telegram turn, restart Hermes and
retrieve it again. The editable native vault is
`/var/lib/hermes-real-ming/obsidian-vault`; the generated Real-Ming CEO
projection remains `/var/lib/real-ming/obsidian`. Do not sync either directory
to another device until its scope is reviewed.

Finally run the protected backup service and inspect the manifest for the
whitelisted native Hermes state/profile files and native-vault hashes. Restore
that set to an isolated directory with providers, delivery and schedules
disabled. No OAuth, auth, config, cache or log file belongs in the backup.
These checks are required before milestone 6 can be marked accepted.

For the isolated restore, engineering provides an explicit guarded command
after the backup ID is known (replace only the two paths; never paste a secret):

```bash
npm run control-plane:restore -- --live \
  --backup /var/lib/real-ming/backups/<backup-id> \
  --destination /var/lib/real-ming/recovery-rehearsal/<backup-id>
```

The destination must be new and must remain disconnected from providers,
delivery and schedules. A non-zero exit means the manifest or SQLite
integrity check failed; stop and report it rather than retrying against a
different destination.

## 9. V6 acceptance matrix — pending CEO review

The engineering matrix in
[milestone 8 evidence](../docs/evidence/RM-40-v6-milestone-8-acceptance-evidence.md)
keeps controlled tests separate from live/user acceptance. After the native
cron and memory checks above, review these remaining rows from an authorized
phone and Tailscale device:

- attachments, semantic follow-up and progress during a real multi-step Telegram request are now user-observed; see the [Telegram/memory acceptance evidence](../docs/evidence/RM-40-v6-telegram-memory-acceptance-2026-09-06.md);
- one bounded DuitSini coding task, including a real diff, test result and
  failure/retry behavior;
- one read-back of the linked Notion Master Task, preserving the status
  meanings and review-ready distinction;
- the private native and Real-Ming dashboard views side by side; and
- one Lenovo-off task proving Azure continuity and an honest unavailable result
  for laptop-only tools.

Record only visible answers, artifact/provider read-backs, correlation IDs and
timestamps. Do not paste raw transcripts, hidden reasoning, chat IDs or
credentials into the repository.

## 10. V6 recovery and closeout — pending CEO execution

The controlled restore boundary is documented in
[milestone 9 evidence](../docs/evidence/RM-40-v6-milestone-9-recovery-evidence.md).
After the first accepted native conversation, run the protected backup once,
verify the manifest-last upload contains the Hermes native state and vault, and
restore it to an isolated destination with providers, delivery and schedules
disabled. Confirm SQLite integrity and native continuity before enabling
anything in the restored copy.

Then review restart/reconciliation, cost/usage and retention evidence; update
the baseline, readiness report and issue evidence; and only after acceptance
deallocate the retained East Asia VM. Deallocate/stop is reversible; deletion
is not approved.

## 1. Authorize Hermes to use the Codex subscription

### Why Ming must do this

OpenAI requires the account owner to authenticate and consent. The resulting
OAuth state belongs only to Hermes's protected service account on Azure.
Real-Ming and the deployment agent must never receive or copy the token.

### Historical steps (already completed)

1. Tell the active Codex task: **Issue a fresh Hermes Codex device code.**
   Device codes expire, so do not reuse one from an older message.
2. Open `https://auth.openai.com/codex/device` in your browser.
3. Sign in with the ChatGPT account whose Codex subscription Hermes should use.
4. Enter the short-lived code shown by the active Codex task.
5. Approve the authorization and wait until the browser reports success.
6. Tell the active Codex task that authorization succeeded. Do not copy any
   token or browser response into the conversation.

### Expected result

The agent will verify credential metadata without printing credential values,
start Hermes on loopback `127.0.0.1:8642`, prove unauthenticated requests are
rejected, and run a harmless GPT-5.6 Sol conversation using provider
`openai-codex` with medium reasoning.

## 2. Enroll the Malaysia host in Tailscale

### Why Ming must do this

Joining the host to Ming's private tailnet requires the tailnet owner's sign-in
and consent. This supplies private dashboard reachability without opening a
public dashboard or SSH port.

### Historical steps (already completed)

1. Tell the active Codex task: **Issue or show the current Malaysia Tailscale
   authorization link.**
2. Open that link and sign in to the same Tailscale account used by the Lenovo.
3. Approve the device named `real-ming-malaysia`.
4. If Tailscale asks whether to replace or remove another machine, do not do
   so; approve only the new Malaysia device.
5. Tell the active Codex task that the device was approved.

### Expected result

The agent will verify that the new device is connected, record only its private
Tailscale address, and establish an SSH tunnel from the Lenovo to the
loopback-only dashboard. No public Azure network rule will be added.

## 3. Perform the Telegram CEO smoke checks

The ownership cutover is complete. Malaysia West is the sole polling owner;
the East Asia service is stopped. Sending these messages now tests the Phase 4
candidate.

1. Send one harmless natural-language question to the existing Real-Ming bot.
2. Confirm that the response feels like a Hermes answer rather than the former
   fixed worker response.
3. Send one bounded coding request for a non-sensitive GitHub project. Do not
   ask it to merge, deploy, delete data or change production.
4. The agent must replay the same update ID in the verification harness to
   test durable idempotency. Sending the same text again from Telegram creates
   a new update and does not test duplicate-update handling.
5. When requested, send only the scanner-safe synthetic credential string
   supplied by the agent. Never use a real or previously valid credential.
6. Report any missing, duplicated or obviously truncated reply immediately.

### Expected result

- Real-Ming remains the one Telegram polling owner.
- Hermes supplies the reasoning, plan, coding work and final answer.
- Real-Ming records the conversation mapping, role/Work Item proposal,
  projections, tool decisions and outcome metadata.
- The duplicate update returns the durable result without duplicate work.
- The synthetic secret is refused before Hermes receives model context.

## 4. Review the private dashboard

The native dashboard currently answers on `127.0.0.1:9119` through a
temporary process; the supervised `hermes-dashboard.service` is staged in the
new candidate but is not installed/enabled on Malaysia yet. Real-Ming answers
on `127.0.0.1:8787` and remains bearer-authenticated. After the candidate is
approved and the unit is installed, the agent will create the private tunnel
and open both views. Ming must visually confirm:

- Hermes Runtime reports healthy and identifies the expected model/provider.
- Conversations show metadata and durable status without prompts,
  chain-of-thought or credential content.
- The Telegram test has a corresponding Work Item and audit evidence.
- Provider health and scheduler sections render normally.
- No unexpected duplicate Work Item or conversation exists.

Do not request a public production domain during this activation. Public DNS,
TLS and identity-aware access remain a separate design and approval decision.

## 5. Review the Obsidian output

After the agent triggers a successful Knowledge Compiler generation, confirm
that the CEO-only host-local export contains useful reviewed projections. It
must not contain raw cross-domain memory, secrets, OAuth state or unreviewed
provider payloads.

The first activation intentionally enables no Obsidian sync. Connecting this
folder to another device or cloud sync service requires a separate review.

## 6. Confirm final completion evidence

The earlier Malaysia West green/blue approval covers the already-executed
candidate and East Asia rollback retention. It does **not** silently approve a
new image/bundle, installing the staged dashboard unit, creating Telegram-
delivering native cron jobs, or changing the protected memory-write setting;
those are the explicit live decisions in sections 7–10.

Before accepting completion, check that the agent reports all of these:

- Hermes OAuth, loopback health and GPT-5.6 Sol conversation passed.
- Telegram question, coding request, duplicate and secret-refusal checks passed.
- Private dashboard and Obsidian review passed.
- A new off-host backup includes Real-Ming state, the Hermes conversation map,
  all whitelisted native Hermes durable state/profile files and the native
  vault, but no OAuth/auth/config file.
- The restore rehearsal passed manifest hashes and SQLite checks.
- East Asia was deallocated, not deleted, and remains available for rollback.
- Malaysia West is the only active Telegram owner.
- Repository checks passed and the runbook/status board were updated.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Codex device code expired | Ask the active Codex task to issue a fresh code; do not copy OAuth state from the Lenovo |
| OpenAI account page requests MFA | Complete MFA personally; the agent must not enter it |
| Tailscale link expired | Ask the active Codex task for the current authorization link |
| Wrong Tailscale account appears | Stop and sign in with the Lenovo's existing tailnet account |
| Telegram gives no response after cutover | Tell the active Codex task immediately; do not start another Telegram gateway |
| Dashboard cannot open | Keep all Azure ports closed and ask the agent to inspect the Tailscale/SSH tunnel |
| Any page displays a secret unexpectedly | Stop, do not paste it anywhere, and tell the agent only which credential type may have been exposed |
