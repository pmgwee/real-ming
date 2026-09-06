# RM-40 · Milestone 3 — native Telegram cutover, executed

Executed 6 September 2026, 03:58–04:14 UTC (11:58–12:14 Asia/Kuala_Lumpur) on
`real-ming-control-plane-my`, under the CEO's explicit approval to use the
production bot and make the required changes.

## TL;DR

**The Malaysia side of the cutover is done.** Real-Ming now runs the Revision 6
image and no longer polls Telegram; the native Hermes gateway owns the
transport and is configured with the production bot credential and Ming's
allowlist. Two defects found in earlier milestones are fixed and verified.

**One thing blocks completion: something outside this host is still polling the
same bot token.** Telegram returns `409 Conflict` even with every Malaysia
poller stopped. I cannot reach the machine that is doing it. This needs Ming.

The system is in a safe, correct state while blocked: Hermes retries Telegram in
the background and will take the transport the moment the other consumer stops.
No further action is needed on my side once it does.

## What was changed

| # | Change | Verification |
| --- | --- | --- |
| 1 | Pre-cutover backup taken | Generation `2026-09-06T04-01-39.054Z`; contains `state.sqlite`, `notion-write-ledger.sqlite`, `hermes.sqlite` and native `hermes-state.db` with SHA-256 per file |
| 2 | Native default model set to `gpt-5.6-sol` / `openai-codex`; the OpenRouter `base_url` unset | A one-shot run with **no model flags** returned the expected token and reported `model: gpt-5.6-sol, provider: openai-codex`. **Milestone 1 defect 2 is fixed** |
| 3 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`, `TELEGRAM_HOME_CHANNEL` written into the protected Hermes `.env` (0600, `real-ming`-owned) | Fetched from Key Vault through the VM managed identity in a single pipeline; **no value was displayed, logged or copied**. Verified by name and length only |
| 4 | `python-telegram-bot[webhooks]==22.8` installed into the Hermes venv | The gateway's auto-install failed under systemd confinement. Installed with `uv` at the exact pin from the pinned source. `import telegram` → 22.8 |
| 5 | Revision 6 image built and deployed | `real-ming:rev6-fb2756a` built on-host from commit `fb2756a`; container running that tag |
| 6 | `REAL_MING_TELEGRAM_OWNERSHIP=native-hermes-gateway` in `release.env` | In-container `printenv` returns `native-hermes-gateway` |
| 7 | systemd unit updated to pass that variable through | See the defect below |

## Defect found during the cutover — and fixed

**My milestone 2 work was incomplete, and production wiring is what exposed it.**

`real-ming.service` passes an explicit list of `--env` names to `docker run`.
`REAL_MING_TELEGRAM_OWNERSHIP` was not in that list. So when the container
started, the variable was set in `release.env`, read correctly by the
composition, and **never reached the process**. Real-Ming silently defaulted
back to owning Telegram and started polling — the exact double-consumer state
the whole migration exists to prevent. Measured: 2 open connections to
`149.154.166.110`.

This is a textbook illustration of why *production-wired* is a separate evidence
state from *controlled-tested*. Five System Harness scenarios proved the mode
works. None of them could see a `docker run` flag.

Fixed in two places:

1. `deploy/systemd/real-ming.service` now passes the variable through.
2. `src/runtime/control-plane-deployment-preflight.ts` gained a check that scans
   the composition root for every `REAL_MING_*` name it reads and fails the
   build unless each one either reaches the container or is listed as
   deliberately undeployed **with a stated reason**. Five names are listed with
   reasons; the rest must be passed through.

The check was verified by removing the flag again: the preflight failed with
`deploy/systemd/real-ming.service:unpassed-env:REAL_MING_TELEGRAM_OWNERSHIP`,
and passed once restored.

## The blocker — an external consumer of the same bot token

### What is proven

With **every Malaysia poller stopped** — `hermes.service` stopped, Real-Ming
running in native mode, and `ss` showing zero connections to Telegram's IPs — a
long-poll `getUpdates` issued directly from the host returned:

```
ok: False | error_code: 409 | Conflict: terminated by other getUpdates request
```

Twice, consecutively. `getWebhookInfo` shows no webhook (`url: ''`), so a
webhook is not the cause. The bot is `@MingCreativesBot`, id `8943517477`.

### A wrong conclusion I drew on the way, and the correction

An earlier probe with `timeout=0` returned `ok: True` and I reported that there
was no external consumer. **That was wrong.** A zero-timeout `getUpdates`
returns immediately and does not contest the long-poll lock, so it cannot
detect the conflict. Only the long-poll form is a valid test. I had also
hypothesised the East Asia VM, then withdrawn that hypothesis on the strength of
the bad probe. The long-poll result restores it.

### What was ruled out

| Candidate | Result |
| --- | --- |
| Real-Ming on Malaysia | **Ruled out.** Container runs in native mode; zero Telegram connections; verified by `ss` and by `printenv` |
| A second Hermes gateway on Malaysia | **Ruled out.** `hermes gateway list` shows one; no Telegram connections while stopped |
| A Telegram webhook | **Ruled out.** `getWebhookInfo` returns an empty URL |
| A local process on Ming's Windows machine | **Ruled out.** No `node` process runs the control plane; nothing matches `real-ming` or `control-plane` in any command line |
| **East Asia VM `real-ming-control-plane`** | **Most likely.** It is `active` on Tailscale at `100.122.240.61`, answers ICMP, and has TCP/22 open — it was never deallocated. `real-ming.service` is `enabled` there, so any reboot would restart it automatically |

### Why I cannot resolve it myself

- SSH to `100.122.240.61` is refused: the only key on this machine
  (`real_ming_southeastasia_ed25519`) is not authorised there, and `publickey`
  is the sole accepted method.
- Tailscale SSH is not enabled on that host, so the tailnet offers no way in.
- There is no Azure control-plane access from here: no `az` CLI, no `Az`
  PowerShell module, no `~/.azure` token cache. The Malaysia VM's managed
  identity holds only Key Vault Secrets User and Storage Blob Data Contributor
  — it cannot stop another VM.

## What Ming needs to do — one action

Stop the East Asia VM. **This is already an approved action:** the activation
runbook records the decision to "deallocate — but do not delete — the East Asia
VM for rollback," and it has been outstanding since 5 September. It is now
blocking the thing it was supposed to follow.

Either route works:

1. **Azure Portal** → Virtual machines → `real-ming-control-plane` → **Stop**.
   Stop, not Delete. The disk and the VM are retained for rollback.
2. **SSH in with whatever key you hold** and run
   `sudo systemctl disable --now real-ming.service`. Disabling matters as much
   as stopping: the service is `enabled`, so a reboot would restart the conflict.

If the conflict persists after that, the consumer is somewhere else and I will
need to know what other machine has ever held this bot token.

## What happens automatically once it stops

Nothing further is required from me. The gateway's reconnection watcher is
running and retries Telegram in the background; it will connect on its own. If
it has exhausted its retry budget by then, one `systemctl restart hermes.service`
finishes it — tell me and I will run it.

## Current state

| Component | State |
| --- | --- |
| `hermes.service` | active; `api_server` connected; `telegram` retrying |
| `real-ming.service` | active; image `real-ming:rev6-fb2756a`; ownership `native-hermes-gateway`; **not polling** |
| Dashboard | responds `401` on loopback — private and authenticated, as intended |
| Durable state | 33 Work Items (18 Captured, 10 Planned, 3 Ready for CEO Review, 2 Waiting/Blocked); ingress cursor `510595576` recorded before cutover |
| Network | unchanged; no public SSH, Hermes or dashboard rule |
| Rollback | `release.env.pre-rev6`, `real-ming.service.pre-rev6`, `config.yaml.pre-rev6`, `.env.pre-rev6` all saved on the host; previous image `real-ming:phase4-af75e3c` still present |

## Still not proven

The phone matrix — native commands, formatting, typing indicator, attachments,
session continuity and a real coding request over Telegram — has not run. It
cannot until the transport connects. That remains the milestone 3 pass
criterion and it is Ming's to judge.
