# Phase 4 CEO actions

## TL;DR

The Malaysia West Phase 4 candidate is prepared but deliberately inactive.
Only Ming can complete the identity checks and send the live Telegram test
messages. The agent will perform the service activation, verification,
dashboard tunnel, recovery rehearsal and approved East Asia deallocation.

Start here when resuming:

1. Complete the Codex OAuth action below.
2. Complete the Tailscale action below.
3. Reply to the active Codex task with: **I completed Codex OAuth and
   Tailscale authorization. Continue RM-40 Phase 4 activation.**
4. Remain available for the Telegram and CEO review checks when requested.

Do not paste any OAuth token, Telegram token, dashboard token, Key Vault
secret or Tailscale credential into Codex, Telegram, GitHub or this file.

## Current safe checkpoint

| Item | State |
| --- | --- |
| Malaysia West VM `real-ming-control-plane-my` | Prepared and running as the inactive green host |
| Reviewed Real-Ming image | Exact approved digest restored and verified |
| Hermes | v0.21.0 at the pinned commit; installed but inactive |
| Real-Ming on Malaysia West | Inactive |
| Real-Ming on East Asia | Active and still the sole Telegram polling owner |
| Hermes bridge key | Stored in Azure Key Vault and protected host configuration; value never displayed |
| Backup | Singapore storage generation restored and SQLite-verified |
| Obsidian | CEO-only host-local destination staged; no sync enabled |
| Network | No public SSH, Hermes or dashboard inbound rule |

The complete technical sequence and rollback plan remain in
[RM-40-phase4-activation-runbook.md](RM-40-phase4-activation-runbook.md).

## 1. Authorize Hermes to use the Codex subscription

### Why Ming must do this

OpenAI requires the account owner to authenticate and consent. The resulting
OAuth state belongs only to Hermes's protected service account on Azure.
Real-Ming and the deployment agent must never receive or copy the token.

### Steps

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

### Steps

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

Do this only when the active Codex task explicitly says the ownership cutover
has completed. Sending these messages earlier tests the East Asia service,
not the Phase 4 candidate.

1. Send one harmless natural-language question to the existing Real-Ming bot.
2. Confirm that the response feels like a Hermes answer rather than the former
   fixed worker response.
3. Send one bounded coding request for a non-sensitive GitHub project. Do not
   ask it to merge, deploy, delete data or change production.
4. When requested, replay the designated test update so the agent can prove
   durable idempotency without creating a second Hermes turn or Work Item.
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
