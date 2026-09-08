# Dashboard and Obsidian — Access Runbook

**TL;DR** — Both surfaces are loopback-only by design. You reach them by
opening an SSH tunnel from your laptop over Tailscale. There is no password to
type, no port to open on Azure, and nothing exposed to the internet. Every
command below was run end to end on 7 September 2026, and the output shown is
what actually came back.

# 🎯 Why this needs you

The tunnel runs on your machine, under your Tailscale identity and your SSH
key. I can prove the commands work — and I did — but I cannot hold a session
open on your laptop, and I cannot judge whether the dashboard is useful enough
to keep. Part 2 also installs desktop software, which is yours to install.

# 🧰 Prerequisites

| Need | Check | Fix |
| --- | --- | --- |
| Tailscale up on the laptop | `tailscale status` lists `real-ming-malaysia` | Sign in to Tailscale |
| Host reachable | `ping 100.110.253.35` | Confirm the VM is Running, not deallocated |
| SSH key present | `ls ~/.ssh/real_ming_southeastasia_ed25519` | It is the key used for every deployment this milestone |

## 🐚 Which shell

**PowerShell** for everything except the Obsidian pull. That one needs **Git
Bash** (or WSL), because it pipes binary between two `tar` processes and
PowerShell 5.1 pipes objects rather than bytes — the archive arrives corrupted.

PowerShell 5.1 also has no `&&`, so `a && b` is a parser error, not a silent
failure. Where a command below needs two steps, they are written as two steps.

One command proves all three prerequisites:

```powershell
ssh -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35 true; if ($?) { "reachable" }
```

Expected output: `reachable`

---

# 🖥️ Part 1 — The agent dashboard and Kanban

## Step 1 · Open the tunnel

Run this and **leave the window open**. It is the tunnel; closing it closes the
dashboard.

```powershell
ssh -N -L 9119:127.0.0.1:9119 -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35
```

It prints nothing at all. That is correct — `-N` means "open the tunnel, run no
command". Silence is success.

## Step 1b · Make it one command (do this once)

You have no `~/.ssh/config` today, so this creates one rather than editing it.

```powershell
notepad $HOME\.ssh\config
```

Paste this in and save:

```
Host ming-dash
    HostName 100.110.253.35
    User azureuser
    IdentityFile ~/.ssh/real_ming_southeastasia_ed25519
    LocalForward 9119 127.0.0.1:9119
```

From then on, Step 1 is the whole command:

```powershell
ssh -N ming-dash
```

Verified working on 8 September 2026.

If you would rather double-click, save this on the Desktop as
`Ming Dashboard.cmd`:

```
@echo off
start "" ssh -N ming-dash
timeout /t 3 >nul
start "" http://127.0.0.1:9119
```

Closing the SSH window still closes the tunnel. That has not changed.

## Step 2 · Open the browser

Go to **http://127.0.0.1:9119** (`localhost:9119` works too; no other hostname
will, on purpose — see Troubleshooting).

## Step 3 · There is no login

You will land straight on the dashboard. That is not a misconfiguration.

The dashboard mints a random session token when the gateway starts, injects it
into the page's own HTML, and the page hands it back on every request. The
token never leaves your tunnel, is different after every restart, and dies with
the process. Because the server is bound to `127.0.0.1`, the only way to reach
the page at all is through the tunnel you just opened — so possession of the
tunnel *is* the authentication.

This is also why a password would add nothing: anyone who could reach the port
would already be inside your Azure host.

## Step 4 · What you are looking at

Left sidebar: **Chat · Sessions · Files · Models · Logs · Cron · Skills ·
Plugins · MCP · Channels · Webhooks · Pairing · Profiles · Config**, with
`Gateway Status: Running` underneath.

The landing page is **Sessions**. On 7 September it showed 26 sessions and 350
messages, with `api_server` and `telegram` both **Connected** — those two green
rows are the single-consumer invariant holding: one Telegram connection, owned
by native Hermes.

Recent sessions listed there are the real work from this milestone, including
`Diagnose DuitSini Vitest test failures` and `Handle missing .env in smoke
tests`.

## Step 5 · The Kanban board

Go to **http://127.0.0.1:9119/kanban** (it is also listed under *Plugins* with
an **Open** link).

Eight columns: **Triage · Todo · Scheduled · Ready · Running · Blocked · Review
· Done**. All are empty today, which is expected — nothing has been filed on it
yet. The board is Hermes's own multi-agent work board, stored at
`/var/lib/hermes-real-ming/kanban.db`. It is **not** the Notion Master Tasks
database and does not sync with it.

Worth knowing before you invest in it: this board is where Hermes tracks work it
is running for itself. Your executive task list still lives in Notion.

## Step 6 · Confirm the two scheduled jobs

Go to **http://127.0.0.1:9119/cron**. You should see exactly:

| Job | Schedule | Delivery |
| --- | --- | --- |
| Real-Ming Morning Brief | Daily at 07:30 | telegram → your chat id |
| Real-Ming Executive Roll-Up | Daily at 21:30 | telegram → your chat id |

Both show status `scheduled`, `repeat: forever`, and a **Next** timestamp. Times
are Malaysia time — the gateway's `timezone` is `Asia/Kuala_Lumpur`.

## ✅ Part 1 test cases

| Do this | Expect |
| --- | --- |
| Open `http://127.0.0.1:9119` with the tunnel up | Dashboard loads, no login prompt |
| Look at Connected Platforms | `api_server` and `telegram` both green |
| Open `/kanban` | Eight empty columns |
| Open `/cron` | `Scheduled Jobs (2)`, at 07:30 and 21:30 |
| Close the tunnel window, reload | Browser cannot connect — correct, the tunnel is the door |

---

# 📓 Part 2 — Obsidian

## First, the honest framing

**Hermes has no Obsidian integration.** I checked the installed package: there
is no Obsidian plugin, toolset or config key. The "vault" is simply a folder of
Markdown files that the agent writes with its ordinary file tools.

Obsidian is just a reader you point at that folder. So "setting up Obsidian"
means two things and nothing more: install Obsidian, and get the folder onto
your laptop.

## What is in the vault today

Location on the host: `/var/lib/hermes-real-ming/obsidian-vault`

Contents: **one** note, `Native cron ownership.md`, written by the agent on
7 September when it recorded the cron cutover. That single note is the proof the
write path works.

The folder is `drwx------ real-ming:real-ming`, so the `azureuser` login cannot
read it directly — which is why the pull command below uses `sudo tar`.

## Step 1 · Install Obsidian

Download from obsidian.md and install. It is free for personal use; no account
is required for local vaults.

## Step 2 · Pull the vault to your laptop

**Git Bash, not PowerShell.** This pipes binary between two `tar` processes;
PowerShell 5.1 pipes objects, so the archive arrives corrupted rather than
failing outright — which is the worse outcome, because it looks like it worked.

```bash
mkdir -p ~/Obsidian/real-ming
```

```bash
ssh -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35 'sudo tar cz -C /var/lib/hermes-real-ming/obsidian-vault .' | tar xz -C ~/Obsidian/real-ming
```

Verify, still in Git Bash:

```bash
ls -la ~/Obsidian/real-ming
```

Or in PowerShell, where `ls -la` is a parameter error:

```powershell
Get-ChildItem $HOME\Obsidian\real-ming
```

Expected: `Native cron ownership.md`

## Step 3 · Open it in Obsidian

Obsidian → **Open folder as vault** → choose `~/Obsidian/real-ming`. Decline the
"trust author / enable plugins" prompt; nothing here needs plugins.

You should see the single note render, with its link back to the milestone 5
evidence file.

## Step 4 · Refreshing it later

Re-run the Step 2 command. It overwrites what changed and adds what is new.

## ⚠️ This is a one-way pull

Host → laptop, only. **If you edit a note in Obsidian, your edit is not sent
back to the agent, and the next pull will overwrite it.** Treat the local copy
as a reader.

Making it two-way needs either Syncthing over Tailscale or a paid Obsidian Sync
subscription. Both are real options; neither is set up, and choosing one is a
decision, not a step — see the Decisions table in `README.md`.

## ✅ Part 2 test cases

| Do this | Expect |
| --- | --- |
| Run the Step 2 pull | Exit code 0, no output |
| `ls ~/Obsidian/real-ming` | `Native cron ownership.md` |
| Open the folder as a vault | The note renders with its heading and link |
| Ask the agent in Telegram to write a note, then re-pull | A second `.md` file appears |

---

# 📱 Part 3 — From your phone

**Yes, but through the same kind of tunnel — and there is no way around that.**

The dashboard answers only to `127.0.0.1:9119` and `localhost:9119`. Every other
`Host` header, including the Tailscale name and the Tailscale IP, gets an HTTP
400. Measured against the running host on 8 September 2026:

| `Host` header sent | Response |
| --- | --- |
| `127.0.0.1:9119` | 200 |
| `localhost:9119` | 200 |
| `real-ming-malaysia` | 400 |
| `real-ming-malaysia.tail54f32e.ts.net` | 400 |
| `100.110.253.35:9119` | 400 |

That is deliberate, and it is the same protection described in Part 1 Step 3.
The dashboard's entire authentication is *"you reached me over loopback"* — it
mints a token and injects it into the page. If it also trusted a hostname, any
web page you visited could point that name at your own loopback and read the
token. Hermes says so in its own help text: *"Bind 127.0.0.1 + tunnel to keep
it local."*

## What works today, with no change to the server

Two apps on the phone:

1. **Tailscale** — sign in with the same account. The phone joins the tailnet
   and can reach `100.110.253.35`, exactly as your laptop already does.
2. **An SSH client that can do local port forwarding** — forward the phone's
   `9119` to `127.0.0.1:9119` on the host, then open `http://127.0.0.1:9119` in
   the phone's browser. The `Host` is loopback, so it is accepted.

Candidates are Termius (iOS and Android), or Termux with `openssh` on Android.
**I have not tested either on your phone.** Local port forwarding sits behind
the paid tier in some clients, and I cannot verify that from here.

Expect one nuisance on iOS: the system suspends backgrounded apps, so the
tunnel tends to drop when you switch from the SSH app to the browser. Android
with Termux and `autossh` holds it open more reliably.

## What looks like the answer but is not

**Tailscale Serve.** Two independent reasons, both checked on 8 September:

- Serve is **not enabled on your tailnet** at all. The host reported
  *"Serve is not enabled on your tailnet"* and printed an admin-console link.
- Enabling it would still not work. Serve passes the `ts.net` hostname through
  as the `Host` header, which the dashboard rejects with 400 — and
  `hermes dashboard` has **no flag** to allow an additional hostname.

You could put a Host-rewriting proxy in front of it. Do not. That deliberately
disables the rebinding protection above and hands the session token to anything
on the tailnet.

## The supported way, if you want this properly — decision 3

Hermes does support a non-loopback bind. It simply requires real authentication
instead of the loopback assumption: the `--insecure` help documents that a
public bind always demands an auth provider, and `hermes dashboard register`
wires OAuth through Nous Portal.

Choosing it changes the deployment contract, so it is yours rather than mine:

- `src/runtime/control-plane-deployment-preflight.ts` pins `--host 127.0.0.1`
  and fails the build if that changes
- `docs/BASELINE.md` states the dashboard is loopback-only
- It would need an ADR

**Recommendation: not yet.** You already carry the agent on your phone — that is
Telegram, and it is the interface that actually matters. The dashboard is for
inspection. Milestone 9 asks you to judge whether it earns its keep at all;
answer that first. If it turns out you want it in your pocket weekly, the ADR
is worth writing then, on evidence.

---

# 🧯 Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `channel 2: open failed: connect failed` | The gateway is not running | `ssh … 'sudo systemctl status hermes'` |
| Browser: "can't connect" | Tunnel window was closed | Re-run Step 1 and leave it open |
| `bind: Address already in use` | A tunnel is already open on 9119 | Use the existing window, or close it first |
| Dashboard loads but panels stay empty | Page opened before the tunnel settled | Reload once |
| Any hostname other than `localhost` / `127.0.0.1` fails | Deliberate: the app rejects other `Host` headers to block DNS-rebinding attacks | Use `127.0.0.1` |
| `sudo: a terminal is required` on the vault pull | `sudo` wants a password prompt | The deployment key is configured for passwordless sudo; confirm you passed `-i` with the right key |
| `tar: command not found`, or a corrupted archive | Wrong shell for the vault pull | Use Git Bash or WSL; PowerShell cannot pipe binary between processes |
| `The token '&&' is not a valid statement separator` | PowerShell 5.1 has no `&&` | Run the two commands separately, or use `; if ($?) { ... }` |
| Kanban shows no board | Plugin disabled | Plugins → Kanban → Enable |
| Phone browser cannot connect to `127.0.0.1:9119` | The phone's own tunnel is not up, or the SSH app was backgrounded | Re-open the SSH client and re-establish the forward — see Part 3 |
| Tailscale name or IP returns `400` in any browser | By design, not a fault | Reach it as `127.0.0.1` through a tunnel — see Part 3 |

# 📎 What this runbook does not cover

Neither surface is on the public internet, and neither should be put there.
Exposing the dashboard would publish your session history, model keys and file
browser behind a token that regenerates on every restart. The tunnel is not a
workaround for missing access control — it *is* the access control.

Real-Ming's own dashboard is separate and equally loopback-only; the same
pattern reaches it:

```powershell
ssh -N -L 8787:127.0.0.1:8787 -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35
```
