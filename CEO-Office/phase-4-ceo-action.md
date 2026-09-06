# Phase 4 CEO actions

> **Current next step · 6 September 2026:** Engineering follows [the V6 native-first implementation plan](RM-40-v6-native-first-implementation-plan.md). Its final CEO-action table distinguishes access, product choices and acceptance from implementation work. The checks below describe the recorded V5 activation; repeat phone acceptance after the native candidate is ready. No new login requirement has been established by the plan.

## Nothing is blocking engineering today · 6 September 2026

Milestones 0 and 1 are complete and needed no action from you. Codex OAuth and
Tailscale were re-confirmed healthy at 03:14 UTC — **do not sign in again**.
Milestone 2 is repository work and needs no new authorization, so engineering
continues while these sit open.

Three decisions are waiting. None of them stops work today.

| # | Decision | What I need | My recommendation |
| --- | --- | --- | --- |
| 1 | **RM-40 (#41) acceptance criteria** | A yes before I post an issue comment. The open readiness ticket is written for Revision 5 and contains no criterion for native Telegram ownership, native presentation, a real coding loop or native memory. Passing it as written would repeat exactly the drift we just documented. Exact proposed wording is in [the requirement ledger §6](RM-40-v6-requirement-ledger.md). **Nothing has been written to GitHub.** | Approve. Keep all six existing criteria as the controlled-test floor and add the five native-experience criteria on top. |
| 2 | **Optional curated-knowledge guarantees** | A direction, not an urgent answer. Versioned atomic publication, contradiction quarantine and access-controlled cross-domain projection are built and controlled-tested but were never wired to a production caller. Revision 6 makes them optional rather than default. | Defer. Prove native Obsidian/LLM-Wiki knowledge works in milestone 6 first, then decide against real observed gaps. The code and design are preserved either way. |
| 3 | **Telegram cutover window** | Not requested yet. Milestone 3 will stop the Real-Ming consumer and start the native Hermes gateway on the same bot. | I will come back with a concrete candidate, the checks, the expected effects and the rollback before asking. The Revision 5 approved image digest is not approval for a Revision 6 artifact. |

**What changed on 6 September.** The specification, ADRs, baseline labels and
tests are reconciled to Architecture Revision 6 ([ADR-0020](../docs/adr/0020-run-ming-on-the-native-hermes-runtime.md)),
every Revision 5 requirement now carries an explicit keep/revise/defer/remove
disposition, and native Hermes was proven to perform a real coding loop on a
disposable fixture — 15 native tool calls, a real diff, an independently
verified test exit status of 0. Two defects in the installed version's scripted
interface were found and recorded. See
[milestone 1 evidence](RM-40-v6-milestone-1-native-runtime-evidence.md).

No production service, credential, network rule or Telegram setting was changed.

## TL;DR

The Malaysia West Phase 4 candidate is active and is now the only Telegram
polling owner. Codex OAuth and Tailscale enrollment are complete. Ming supplied
the first Telegram smoke results: real Hermes answers arrived, but the expected
Telegram experience and complete coding workflow are not ready. Developer
corrections come next; see [Telegram smoke findings](RM-40-phase4-telegram-smoke-findings.md).
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

The agent will create the private tunnel and open the dashboard. Ming must
visually confirm:

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

No additional infrastructure approval is required: Ming already approved the
Malaysia West green/blue activation and deallocation without deletion of the
East Asia VM after successful proof.

Before accepting completion, check that the agent reports all of these:

- Hermes OAuth, loopback health and GPT-5.6 Sol conversation passed.
- Telegram question, coding request, duplicate and secret-refusal checks passed.
- Private dashboard and Obsidian review passed.
- A new off-host backup includes Real-Ming state, the Hermes conversation map
  and Hermes native conversation state, but no OAuth file.
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
