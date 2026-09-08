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

> **Changed on 8 September 2026.** There is no tunnel and no SSH command any
> more. The dashboard is reached at a normal HTTPS address from your laptop or
> your phone, behind a Nous login. See
> [ADR-0021](../docs/adr/0021-reach-the-dashboard-over-tailscale-with-nous-oauth.md).

## Step 1 · Make sure Tailscale is connected

On the laptop it usually already is. On the iPhone, open Tailscale and check it
shows **Connected**; approving the iOS VPN configuration is a one-time prompt,
not something you answer each time. Leave the exit node as **None** — this does
not route your browsing through anything.

If Tailscale is off, the address below simply will not resolve. That is the
security boundary doing its job, not a fault.

## Step 2 · Open the address

**https://real-ming-malaysia.tail54f32e.ts.net/kanban**

Bookmark it on both devices. No tunnel, no SSH client, no port forward, and
your laptop does not need to be running for the phone to work.

## Step 3 · Sign in with Nous Research

The first visit shows **SIGN IN — Choose a sign-in method to continue to the
Hermes Agent dashboard**, with a *Sign in with Nous Research* button and the
footer `PUBLIC BIND · AUTH REQUIRED`. Sign in once; the session persists.

This is a real login, and it is deliberate. Reaching the board now takes four
things in order:

1. a device signed into your tailnet,
2. permitted by the tailnet policy,
3. a successful Nous Portal login,
4. a live dashboard session.

**The dashboard itself never left loopback.** It is still bound to
`127.0.0.1:9119`; Tailscale Serve proxies HTTPS to it, tailnet-only, with
Funnel off. Verified 8 September: unauthenticated requests get `302`, and every
dashboard WebSocket — including the `/api/pty` and `/api/console` terminals —
returns `401` without a session.

Since 8 September the tailnet policy also names which devices may connect: only
your laptop and your phone, and only on the ports each needs. A device added to
the tailnet later does **not** inherit access. Adding one means editing the
policy deliberately, which is the point. The reasoning is in
[ADR-0021](../docs/adr/0021-reach-the-dashboard-over-tailscale-with-nous-oauth.md).

## Step 3b · If you are ever locked out

The SSH tunnel is **no longer a fallback**. A login started at
`127.0.0.1:9119` cannot finish, because the OAuth callback belongs to the
tailnet address. If Serve or Tailscale is broken, recovery is to remove the
public-URL line and restart the unit, which restores passwordless loopback
access in seconds:

```bash
ssh -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35
```

then, at the host prompt:

```bash
sudo sed -i "/^Environment=HERMES_DASHBOARD_PUBLIC_URL=/d" /etc/systemd/system/hermes-dashboard.service && sudo systemctl daemon-reload && sudo systemctl restart hermes-dashboard && echo ROLLED_BACK
```

After that, the old tunnel route works again exactly as it used to.

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

Measured on the running host and confirmed by Ming on both devices,
8 September 2026:

| Do this | Expect |
| --- | --- |
| Open the address with Tailscale connected | Nous sign-in page, then the dashboard |
| Look at Connected Platforms | `api_server` and `telegram` both green |
| Open `/kanban` | The board |
| Open `/cron` | `Scheduled Jobs (2)`, at 07:30 and 21:30 |
| **Turn Tailscale off, reload** | *"This site can't be reached"* — the boundary holding |
| Open it on the iPhone | Same sign-in, then the same board |

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

## Step 2b · The shortcut, now that Obsidian is installed

Obsidian is installed on this laptop, so the folder-picking in Step 3 is only
needed the first time. Afterwards this opens the vault directly:

```
obsidian://open?path=C%3A%5CUsers%5C<YOU>%5CObsidian%5Creal-ming
```

**One caveat that cost time on 8 September.** If Obsidian is already busy
loading another vault, that link is ignored and the vault is never registered.
Check `~/Obsidian/real-ming/.obsidian` afterwards: if that folder does not
exist, Obsidian never opened it, whatever the window appears to show.

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

**Solved on 8 September 2026. There is nothing phone-specific left to do.**

Part 1 already is the phone instructions: connect Tailscale, open the same
address, sign in with Nous. Your iPhone and your laptop have identical
access and identical rights.

No SSH client, no port forwarding, no key on the phone, and your laptop does
not need to be switched on.

## Why it is not an SSH tunnel

It nearly was. The dashboard used to answer only to `127.0.0.1:9119`, so a
phone would have needed an SSH client holding a tunnel open — and on iOS the
system suspends the SSH app the moment you switch to Safari, which is the
one moment you need the tunnel alive. It would have meant buying an app to
get an experience that breaks when you use it.

`HERMES_DASHBOARD_PUBLIC_URL` removed the need. It tells Hermes to trust the
tailnet hostname *and* engages the login gate, while the socket stays on
loopback. Tailscale Serve carries HTTPS to it, tailnet-only.

## What keeps it private

| Layer | What it stops |
| --- | --- |
| RFC 6598 address space | `100.110.253.35` is not routable from the internet |
| MagicDNS | the name resolves only for devices on your tailnet |
| Funnel **off** | the one switch that would publish it stays off |
| Nous OAuth | a stolen unlocked phone still needs your Nous session |
| WebSocket gate | `/api/pty` and `/api/console` return `401` without a session |

The hostname is not a secret and must never be treated as one — it is in
public Certificate Transparency logs. Safety comes from tailnet membership
plus the login, never from the name being hard to guess.

---
# 🗂️ Part 4 — Real-Ming's own dashboard

This is a **different application** from Parts 1–3. Port 9119 is Hermes's agent
dashboard — sessions, Kanban, cron, MCP. Port 8787 is Real-Ming's own dashboard:
Work Items, lifecycle, approvals. Look at both before judging whether either
earns its keep.

Unlike the Hermes dashboard, this one is **token-authenticated**. The tunnel
alone returns `{"error":"authentication-required"}`. That is correct behaviour,
not a fault.

**Laptop only, since 8 September.** This surface is reached through an SSH
tunnel, and the tailnet policy grants port 22 to the laptop alone — the phone
has HTTPS and nothing else. That is deliberate: the phone was given the smallest
grant that serves its purpose, and 8787 is not part of that purpose. Reaching it
from the phone would mean granting SSH there, which is a decision, not a step.

## Step 1 · Open the tunnel

```powershell
ssh -N -L 8787:127.0.0.1:8787 -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35
```

## Step 2 · Get the paste-ready line

One command. It prints the exact JavaScript to paste, with the token already
in it:

```powershell
ssh -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35 ./real-ming-dashboard-cookie.sh
```

The helper reads the token from Key Vault through the VM's own managed
identity. Nothing is written to disk on either machine, and the value appears
only in your terminal — never in this repository, an issue, or a log.

<details>
<summary>Doing it by hand instead</summary>

Azure Portal → **Key Vaults** → `real-ming-vault` → **Secrets** →
`real-ming-dashboard-token` → the current version → **Show Secret Value**.
It is 64 characters.

It is deliberately **not** in `/etc/real-ming/hermes.env`. The container reads
it from Key Vault at startup, so no copy sits on the VM's disk to leak.

</details>

## Step 3 · Paste it into the browser

There is no login page, so the token is planted as a cookie. Open
**http://127.0.0.1:8787**, press **F12**, choose **Console**, paste the line
from Step 2, and press Enter. It looks like this:

```javascript
document.cookie = "real_ming_session=<token>; path=/; max-age=31536000"; location.reload();
```

The page reloads and renders. `max-age` is a year, so this is **one-time per
browser** — afterwards the tunnel alone is enough.

`curl` users can send `Authorization: Bearer <token>` instead.

**Never put the token in the URL.** A query string lands in browser history,
proxy logs and the server log; a cookie does not.

## ✅ Part 4 test cases

Measured on the running host, 8 September 2026:

| Do this | Expect |
| --- | --- |
| Open `http://127.0.0.1:8787` with the tunnel up, no cookie | `401 {"error":"authentication-required"}` |
| Set the cookie, reload | `200`, `text/html` — the dashboard renders |
| `curl` with `Authorization: Bearer <token>` | `200` |
| Close the tunnel, reload | Browser cannot connect |

---

# 🧯 Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `channel 2: open failed: connect failed` | The gateway is not running | `ssh … 'sudo systemctl status hermes'` |
| Browser: "can't connect" | Tunnel window was closed | Re-run Step 1 and leave it open |
| `bind: Address already in use` | A tunnel is already open on 9119 | Use the existing window, or close it first |
| Dashboard loads but panels stay empty | Page opened before the tunnel settled | Reload once |
| `Invalid Host header` from some other name | Only the bound host and the configured public hostname are trusted | Use the tailnet address in Part 1 |
| `sudo: a terminal is required` on the vault pull | `sudo` wants a password prompt | The deployment key is configured for passwordless sudo; confirm you passed `-i` with the right key |
| `tar: command not found`, or a corrupted archive | Wrong shell for the vault pull | Use Git Bash or WSL; PowerShell cannot pipe binary between processes |
| `The token '&&' is not a valid statement separator` | PowerShell 5.1 has no `&&` | Run the two commands separately, or use `; if ($?) { ... }` |
| Kanban shows no board | Plugin disabled | Plugins → Kanban → Enable |
| `{"error":"authentication-required"}` on port 8787 | Correct: Real-Ming's dashboard needs a token, the tunnel is not enough | Plant the `real_ming_session` cookie — see Part 4 |
| Port 8787 still 401 after setting the cookie | Cookie set on the wrong origin, or the token was truncated when copied | Set it while the page itself is open on `127.0.0.1:8787`; the value is 64 characters |
| *"This site can't be reached"* on either device | Tailscale is not connected | Open Tailscale, confirm **Connected**; the exit node should stay **None** |
| Sent to a Nous sign-in page | Correct since 8 Sep 2026 — the dashboard now requires a login | Sign in with Nous Research; the session persists |
| A newly added device cannot reach the dashboard | Correct since 8 Sep 2026 — the tailnet policy names permitted devices | Add it to the policy deliberately, with a test |
| Port 8787 unreachable from the phone | By design — the phone holds no SSH grant | Use the laptop; see the note at the top of Part 4 |
| Obsidian sits on *"Loading cache…"* | It is indexing every file in the open vault, not this one | Check which vault is open; a vault of machine-generated files can hold tens of thousands |

# 📎 What this runbook does not cover

Neither surface is on the public internet, and neither should be put there.
Exposing the dashboard would publish your session history, model keys and file
browser behind a token that regenerates on every restart. The tunnel is not a
workaround for missing access control — it *is* the access control.

Real-Ming's own dashboard is separate, equally loopback-only, and
additionally token-authenticated. It has its own section — see Part 4.
