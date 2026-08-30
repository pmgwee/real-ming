# RM-15 — Choose where Real-Ming actually lives

> **✅ Decided: Azure, Southeast Asia.** See
> [RM-15 — Put Real-Ming on Azure](RM-15-azure-deployment-runbook.md) for what
> to do. This note is kept as the record of how the choice was made.

> **TL;DR — pick one host, then I do the rest.** Gate 1 let you defer this and
> said "by RM-15 at the latest". This is RM-15. Everything that does not depend
> on the answer is already built, tested and pushed. Reply with a host name and
> I provision, deploy, and prove it.

---

## Why this cannot be delegated

It costs money on your card, it holds your credentials, and it becomes the thing
that has to keep running when your laptop is shut. Picking a vendor is a
commitment about cost, data residency and who you trust with the Notion,
Telegram and Google tokens. An agent should not make that choice for you.

Everything else about RM-15 is engineering, and it is done.

---

## What already works, with no host

Committed in `dcd00ea`, 419 tests passing.

| Acceptance criterion | State |
| --- | --- |
| Schedules survive restarts without duplicate execution | ✅ Done |
| Work Item, Approval, notice and audit state survive restarts | ✅ Done |
| Health and recovery visible in the dashboard without exposing secrets | ✅ Done |
| Reachable through Telegram while the Lenovo is asleep | ⬜ **Needs a host** |
| Production-equivalent deployment passes checks and a live smoke test | ⬜ **Needs a host** |

The scheduler runs three things on your clock, each claiming its slot in durable
storage before it runs so a restart cannot double-send:

- **07:00** — release any Exception Notice held overnight by do-not-disturb
- **07:30** — the Morning Brief
- **21:30** — the Executive Roll-Up

Right now nothing calls that scheduler on a timer, because there is nowhere for
a timer to live. That is the whole of what is missing.

---

## What the host has to do

Not much, but these four are non-negotiable:

1. **Stay running.** Not serverless. The Telegram front door and the scheduler
   are a long-lived process.
2. **Keep a disk.** State is SQLite. A host with no persistent volume loses
   every Work Item, Approval and audit row on each deploy.
3. **Hold secrets with rotation.** Ten credentials, and `AGENTS.md` requires
   they live in a secret store, never in Git.
4. **Cost a few ringgit a month.** Your global Metered Platform Cost cap is
   RM250 and this should be a rounding error against it.

---

## Options

My assessment, not verified pricing — check the current rate before you commit.

| Option | Fits? | Why |
| --- | --- | --- |
| **Fly.io** ⭐ | Yes | Persistent volumes suit SQLite, long-running processes are the default, secrets support rotation, and a machine this small is a few dollars a month. |
| **Railway** | Yes | Same shape, simpler console, typically a little dearer. |
| **Small VPS** (Hetzner, DigitalOcean) | Yes | Cheapest and most control. You own patching, firewall and backups — real work, forever. |
| **Vercel** | **No** | Already in your stack for the consent site, so it is the tempting answer. It is the wrong shape: serverless functions, no persistent disk, no long-lived process. SQLite would not survive a deploy. |
| **Home machine / Raspberry Pi** | No | Defeats the point. "While the Lenovo is asleep" includes power cuts and your home internet. |

### If you want a hyperscaler VM

You asked about GCP Compute Engine and Azure Virtual Machines. Both clear all
four requirements, and both are the "small VPS" row above with a bigger console
around them.

| | GCP Compute Engine | Azure Virtual Machines |
| --- | --- | --- |
| Long-running process | Yes | Yes |
| Persistent disk for SQLite | Yes, persistent disk | Yes, managed disk |
| Secret store with rotation | **Secret Manager** — versioned, rotation schedules | **Key Vault** — versioned, rotation policies |
| Nearest region to KL | `asia-southeast1`, Singapore | `Southeast Asia`, Singapore |
| Free allowance | An `e2-micro` free tier exists but only in US regions, which puts the machine far from you | Twelve months of `B1s`, and Azure for Students gives credit without a card |
| Ongoing work | You own OS patching, firewall, TLS, systemd and backups | Same |

**They correct something in my Fly.io recommendation.** I said Fly secrets
"support rotation". That was loose: Fly secrets are environment values you can
replace, not a versioned store with rotation schedules. Secret Manager and Key
Vault genuinely are. `AGENTS.md` asks for "a secret store that supports
rotation", so on that requirement a hyperscaler is the stronger answer, not
merely an equal one.

**What they cost you is not money, it is time.** A VM makes you the system
administrator permanently: kernel updates, firewall rules, certificate renewal,
and — the one people forget — your own backup of the SQLite file. Fly.io and
Railway absorb most of that.

**If you want a hyperscaler, I would pick GCP Compute Engine in
`asia-southeast1`,** for one practical reason beyond features: your Google
credentials already exist for Calendar, so it is one fewer vendor relationship
and one fewer payment method to place. Azure is not worse on the merits; it is
just another account unless you already have student credit there.

### Recommendation

- **Least ongoing work:** Fly.io.
- **Best secret handling, and you accept being a sysadmin:** GCP Compute Engine,
  `asia-southeast1`, with Secret Manager.

Either is defensible. Pick on whether you would rather spend money or evenings.

---

## Steps

1. Reply with the host you want — a name is enough: *"use Fly.io"*.
2. I will write `CEO-Office/RM-15-deployment-runbook.md` with the exact
   commands, and tell you precisely which ones only you can run — creating the
   account, entering payment details, and pasting the ten secrets. **I will not
   create an account or enter a card for you.**
3. You run those steps; I run everything else and prove it.

---

## Test cases

| Test | Expected result |
| --- | --- |
| Shut the Lenovo, send a Telegram message | Real-Ming answers |
| Restart the service mid-day | No duplicate brief or roll-up for that day |
| Restart after a Work Item is created | It is still there, with its audit trail |
| Open the dashboard | Scheduler health shows last run and next run, no secret |
| Run the live smoke test without the flag | It skips rather than contacting a provider |

---

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Brief arrives twice in one day | Two hosts are running the scheduler. Stop one; the occurrence claim only guards one database. |
| State empties after a deploy | The volume is not mounted, or the state file is outside it. |
| Telegram silent while the laptop sleeps | The service is not actually always-on, or its token is missing from the secret store. |
| A secret appears in a log | Stop. Rotate it, then find the log line — `AGENTS.md` forbids credentials in logs. |
| Monthly cost climbs past a few ringgit | The machine is oversized for this workload; scale it down. |
