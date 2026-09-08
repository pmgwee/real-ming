# RM-40 V6 · Milestone 8 — acceptance matrix and remaining live proof

Prepared 6 September 2026. This is a controlled acceptance matrix, not a
claim that the native Telegram experience, production schedules, Obsidian
memory or the private dashboard have been accepted by Ming.

## Evidence-state rule

The rows below deliberately separate **implemented**, **controlled-tested**,
**production-wired**, **live-verified** and **user-accepted**. A green local
test cannot stand in for a phone observation, a provider read-back or a CEO
review. No secret-bearing transcript is stored here.

## Scenario matrix

| Requirement | Controlled evidence | Live/user evidence still required |
| --- | --- | --- |
| V6-CHAT · native Telegram conversation, commands, progress, formatting and attachments | Native-gateway composition tests prove Real-Ming does not poll or reinterpret a turn; phone evidence covers conversation, commands, formatting, attachment understanding, semantic recall through a Hermes restart and staged progress/tool activity during a multi-step request | Broader V6 acceptance still needs the bounded coding, cancellation and unavailable-integration scenarios; see [Telegram/memory acceptance](RM-40-v6-telegram-memory-acceptance-2026-09-06.md) |
| V6-CODE · bounded DuitSini coding loop | Milestone 1 proves a real native Hermes edit/test loop on a disposable fixture; the V6 skill pack keeps repository study, tools, edits, tests and final prose in Hermes | A bounded DuitSini request from Telegram with a clean workspace, failure/retry, exact diff and test exit status; no merge/deploy is implied |
| V6-ROLES · COO, CTO, CMO, Personal CFO and CAO perspectives | Native role playbooks and the controlled skill-pack checks preserve role behavior without a parser or mandatory ceremony | Repeat representative requests from Telegram and record only the visible answer and linked evidence |
| V6-TASKS · Master Tasks meanings and review lifecycle | Real-Ming extension and Provider Adapter Contract Harness prove the status mapping, stable links, replay protection and stale source-version rejection | One authorized Notion read-back after a native execution task is linked; verify review-ready is not reported as completed |
| V6-DAILY · 07:30 brief and 21:30 roll-up | Native cron system tests prove composition, Kuala Lumpur date validation, old-owner migration skip, exact replay and no Telegram call from the composer | Create exactly two native jobs, run each once, restart Hermes, inspect native history and dashboard, then switch the owner flags |
| V6-SOURCES · five source domains | Notion and Calendar have recorded authorized reads; adapters retain provenance/freshness and safe failure semantics | GitHub/Vercel read tokens, any remaining source reads and freshness/error observations |
| V6-KNOWLEDGE · memory, Obsidian and cited Wiki | Native configuration fragment, separate vault path and native-vault backup hashes are implemented and tested | Apply native settings, create a cited note, retrieve it after a follow-up and restart, open the vault and decide whether stronger curated guarantees are needed |
| V6-CEO · private visibility and outcomes | Native Hermes reachability is shown without inventing legacy sessions; the existing read model remains authenticated and secret-safe | Compare both private dashboards from Tailscale, inspect real running/failed/completed work and review the CEO outcome views |
| V6-RECOVERY · Lenovo-off and restart behavior | Control-plane backup now includes optional native state/vault and the isolated restore verifier checks hashes and SQLite integrity | Run the post-conversation backup, restore it with providers/delivery/schedules disabled, restart the Malaysia services and reconcile any in-flight task or delivery |

## Controlled regression snapshot

- Full Vitest: **69 files, 813 passed, 2 intentionally skipped**, exit 0.
- Typecheck, production build, deployment preflight and `git diff --check`:
  exit 0.
- `npm audit --audit-level=high`: exit 0, zero vulnerabilities.
- The browser dashboard checks run with Chromium and are included in the full
  suite; the previously isolated browser run was 4/4 passed outside the
  sandbox.

## Pass boundary

Milestone 8 is **prepared and controlled-tested**, but it is not live-verified
or user-accepted. The outstanding live steps are intentionally collected in
[`CEO-Office/phase-4-ceo-action.md`](../../CEO-Office/phase-4-ceo-action.md),
not hidden in this evidence file.
