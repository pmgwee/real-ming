# RM-15 — Put Real-Ming on Azure

> **TL;DR — you create the account resources and paste ten secrets; I do the
> rest.** One `B1s` virtual machine in Southeast Asia, a Key Vault holding the
> credentials, and a systemd service that keeps Real-Ming running while your
> Lenovo is shut. Set the budget alert in Step 1 before anything else: your $200
> expires in 30 days and then it bills your card silently.

---

## Why this cannot be delegated

Steps 1, 2 and 5 spend your money and hold your credentials. I will not create
an Azure account, enter payment details, or type a credential into a console on
your behalf. Everything after that is engineering and I own it.

---

## Prerequisites

- [x] Azure account, active — `126042693@student.newinti.edu.my`
- [x] The Daily Operations scheduler, committed in `dcd00ea`
- [ ] Azure CLI installed locally (`az --version`)
- [ ] A budget alert (Step 1)
- [ ] The ten credentials from `CREDENTIAL-INVENTORY.md`, still in your `.env`

---

## Why a virtual machine and not a PaaS agent service

You asked whether an Azure agent PaaS could replace the VM. I checked the code
before answering rather than guessing.

**Real-Ming makes no model calls at all.** Searching `src/` for every provider
and inference keyword returns one file, and both hits are the English word
"completion" inside error messages. The Executive Roles — COO, CTO, CAO, CMO,
Personal CFO — are *governance* roles that own Work Items and carry
accountability. They are not hosted chat agents. An agent runtime would be
solving a problem this system does not have.

**SQLite is what actually decides the shape.** State is `node:sqlite`, and the
append-only guarantees rest on **15 database triggers** across the operations
state and the Knowledge Vault. SQLite wants a real local disk. Every Azure PaaS
option — Container Apps, App Service, Container Instances — gives you Azure
Files, which is SMB over the network, where SQLite's locking is unreliable. A
managed disk on a VM is the honest fit.

| Option | Verdict |
| --- | --- |
| **Azure VM** ⭐ | Local managed disk, long-lived process, Key Vault via managed identity. Costs you patching. |
| Azure Container Apps | Genuinely attractive — no OS to patch, cron jobs built in — but only after state moves off SQLite. |
| Azure App Service | Same storage problem. |
| Azure Functions | Wrong shape: no long-lived process, no local disk. |
| Azure AI Foundry Agent Service | Not a host for this process. Useful later as a model provider — see the fuller answer below. |

**Is it useful later?** Container Apps becomes the right answer the day state
moves from SQLite to Postgres. That is a real future ticket, not an RM-15
decision, and it should be taken on its own merits rather than smuggled in here.

---

## ⚠️ What happens on day 31

You said the budget is not a worry because you will unbind the card once the
30-day credit expires. That solves overspending, but it is not the risk here.

**RM-15 exists to make Real-Ming run while your Lenovo is shut — indefinitely.**
Unbind the card and the virtual machine stops. Telegram goes quiet, the 07:30
brief and 21:30 roll-up stop firing, and the ticket is undone. The danger is not
a surprise bill; it is that the always-on host is only always-on for 30 days.

So day 31 is a real decision, and there are three honest answers:

| Option | Cost | Consequence |
| --- | --- | --- |
| Keep paying | roughly **$10–15/month** for a `B1s` — around RM50, well inside your RM250 cap | Nothing changes |
| **Migrate to GCP** | Free — you hold **RM1,318** in credit, roughly 8–12 months of the same size machine | An afternoon of work, if we build for it now |
| Stop | Free | Real-Ming goes back to running only when the Lenovo is awake |

### Your stated exit plan

> "Once the Azure 30-day free credit expires, I will migrate to
> Fly.io / Railway / ReadyServer / Hostinger based on the plan I subscribed to."

Recorded, and the deployment is built for it. Migration becomes: stop the
service, copy one file, start it elsewhere.

**Four rules I am holding myself to so that stays true:**

1. **A container image is the unit of deployment.** It runs unchanged on Fly.io,
   Railway, a Hostinger VPS, a ReadyServer VPS, or the Azure VM.
2. **Environment variables are the only secret interface.** Key Vault is an
   *optional* loader that populates them on Azure — never a hard dependency. If
   I wired the application directly to Key Vault, moving to Fly.io would mean
   rewriting the credential path. It will not.
3. **The state path is configurable**, so the SQLite file follows the volume
   wherever it is mounted.
4. **Backup and restore are a documented, tested procedure**, not a footnote.
   That procedure *is* the migration.

⚠️ **When you subscribe, buy a VPS plan, not shared hosting.** Hostinger and
ReadyServer both sell shared hosting far cheaper, and it will not work here: no
long-lived process, no Docker, and no real local disk for SQLite. Fly.io and
Railway are fine as they are — both give a persistent volume.

Set the budget alert anyway — it is how you learn the credit is nearly gone
before the machine stops, rather than after.

---

## Is Azure AI Foundry the right home for the agents?

You showed me the Foundry Agents portal and you are right that it is a Cloud
Agent PaaS. My earlier answer — "it solves a problem we do not have" — was true
of RM-15 but too dismissive of its future role. The honest split:

**Yes, later, as a model provider and evaluation surface.** Real-Ming will make
model calls: brokered Agent Brain evidence (RM-20), email read-and-draft
(RM-29), the content workflow (RM-32), and model routing with Metered Platform
Cost (RM-37). Foundry's traces, evaluations and guardrails are genuinely useful
there, and its guardrails could help enforce the Sensitive Secret exclusion the
specification requires.

**No, as the runtime that holds context and takes actions.** Two conflicts, and
both are with the parts of the design that give this system its point:

- **Knowledge and Memory in Foundry would bypass the Vaults.** The Context Vault
  (RM-17, RM-18) and Trust-Domain Knowledge Vault (RM-41) exist so Personal
  Context is encrypted, CEO-controlled and role-scoped. Uploading notes into a
  Foundry agent's Knowledge would put that material in a vendor runtime with
  none of those boundaries.
- **A Foundry agent calling tools directly would route around the Policy and
  Approval Engine.** Real-Ming's thesis is that every action is policy-checked
  and irreversible ones need an exact-version Approval. An agent that acts on
  its own is precisely what the Approval Engine exists to prevent.

**Either way it is not RM-15.** Foundry does not host a long-lived Node process
with a local SQLite file. Use it as a provider behind our own gateway, not as a
replacement for it. That decision belongs to RM-37 when model routing is built.

---

## Steps

### Step 1 · Budget alert — do this first (you)

Portal → **Cost Management** → **Budgets** → **Add**.

- Scope: your subscription
- Amount: **RM250** (the cap in the specification)
- Alerts at 50%, 80%, 100%, to your email

Your $200 credit expires in 30 days. Without this you find out by being charged.

### Step 2 · Resource group and virtual machine (you)

Portal → **Create a resource** → **Virtual machine**. Every field, every tab.

#### Three settings that silently break this ticket

Get these wrong and Real-Ming looks deployed but is not:

| Setting | Value | Why |
| --- | --- | --- |
| **Run with Azure Spot discount** | **UNCHECKED** | Spot machines are evicted with about 30 seconds' notice. Fatal for an always-on service. |
| **Auto-shutdown** (Management tab) | **Off** | Azure often defaults it on. It would shut the machine down nightly — the exact opposite of this ticket. |
| **System assigned managed identity** (Management tab) | **On** | Step 3's Key Vault access depends on it. Without it the service cannot read its own credentials. |

#### Basics

| Field | Value |
| --- | --- |
| Subscription | Azure subscription 1 |
| Resource group | **(New)** `real-ming` |
| Virtual machine name | `real-ming-control-plane` |
| Region | **Southeast Asia** if sizes are available, otherwise **East Asia** — see the note below |
| Availability options | Availability zone *(or "No infrastructure redundancy required" — either is fine for one VM)* |
| Zone options | Self-selected zone |
| Availability zone | Zone 1 |
| Security type | Trusted launch virtual machines — **switch to Standard if it blocks the B-series size** |
| Image | **Ubuntu Server 24.04 LTS - x64 Gen2** |
| VM architecture | x64 |
| **Size** | **`B1s`** — click **See all sizes**, search `B1s`. Expect roughly **US$8–10/month**. Anything showing $90 is the wrong size. |
| Run with Azure Spot discount | **UNCHECKED** |
| Authentication type | SSH public key |
| Username | `azureuser` |
| SSH public key source | Generate new key pair |
| SSH Key Type | **Ed25519** — shorter and more modern than RSA |
| Key pair name | `real-ming-control-plane_key` |
| Public inbound ports | Allow selected ports |
| Select inbound ports | **SSH (22)** only |

#### If every small size says `NotAvailableForSubscription`

This happened, and it is a subscription restriction rather than a size or region
fault: the SKU exists in Southeast Asia, but a new subscription is not permitted
to use it there. Microsoft restricts capacity-constrained regions for new
accounts, and Singapore is one of the most constrained it operates.

**The fix is to change the region, and it costs this workload nothing.**

Latency is close to irrelevant here. Real-Ming polls Telegram, calls Notion and
Google, and wakes three times a day. It does not serve interactive requests to
Ming, so 30 milliseconds versus 90 changes nothing he would ever perceive.
"Closest to you" was good general practice, not a requirement of this system.

On **Basics → Region**, try these in order and re-check the size list each time:

| Region | Approx. latency from KL | Note |
| --- | --- | --- |
| **East Asia** (Hong Kong) | ~30 ms | Closest alternative |
| **Japan East** (Tokyo) | ~70 ms | Usually good availability |
| **Australia East** (Sydney) | ~90 ms | Usually good availability |
| **Central India** (Pune) | ~60 ms | Usually good availability |

⚠️ **This decides where your personal data sits.** Task titles, calendar
entries and Work Items would live in that region rather than Singapore. For a
personal system any of these is defensible, but it is your call rather than
mine — pick the one you are comfortable with rather than simply the fastest.

**If you would rather stay in Singapore**, the alternative is a quota request:
Subscription → **Usage + quotas** → search **Standard BS Family vCPUs** →
**Request increase** → ask for 2–4 vCPUs. It is free. Trial subscriptions are
sometimes refused until upgraded to pay-as-you-go, so treat it as the slower
path rather than the reliable one.

Whichever region you land on, still take a **B-series** size — `B1s`, `B1ms`,
`B2ts_v2`. The family matters more than the exact model.

#### Disks

| Field | Value |
| --- | --- |
| OS disk size | Image default (30 GiB) |
| OS disk type | **Standard SSD (locally-redundant storage)** — Premium costs more for no benefit here |
| Delete with VM | ✅ Checked |
| Key management | Platform-managed key |
| Enable Ultra Disk | No |
| Data disks | **None.** State lives on the OS disk; the backup in Step 6 is what protects it, not the disk layout. |

#### Networking

| Field | Value |
| --- | --- |
| Virtual network | (new) default |
| Subnet | default |
| Public IP | (new) — you need it for SSH |
| NIC network security group | Basic |
| Public inbound ports | Allow selected ports |
| Select inbound ports | **SSH (22)** |
| Delete public IP and NIC when VM is deleted | ✅ Checked |
| Load balancing | None |

⚠️ Azure will warn that SSH is open to every IP on the internet. It is right.
Key-only authentication makes it survivable, but this machine will hold your ten
credentials. **After the VM is running, restrict the SSH rule to your own IP**
in the network security group. Do not skip that once you are set up.

#### Management

| Field | Value |
| --- | --- |
| **System assigned managed identity** | ✅ **On** — required by Step 3 |
| Login with Microsoft Entra ID | Off |
| **Enable auto-shutdown** | ❌ **Off** |
| Enable backup | Off — Step 6 backs up the state file itself, which is what matters |
| Enable disaster recovery | Off |
| Patch orchestration | **Azure-orchestrated** — automatic guest patching. A reboot is safe: systemd restarts the service and the scheduler's occurrence claim prevents a duplicate brief. |

#### Monitoring

| Field | Value |
| --- | --- |
| Boot diagnostics | Enable with managed storage account — free, and the only way to see why a boot failed |
| Enable OS guest diagnostics | Off |
| Recommended alert rules | Off — they cost money and the dashboard already reports scheduler health |
| Application health monitoring | Off |

#### Advanced

Leave every field at its default. No extensions, no custom data, no user data,
no proximity placement group. Step 6 configures the machine over SSH.

#### Tags

Optional but worth thirty seconds, because it makes cost attribution readable:

| Name | Value |
| --- | --- |
| `project` | `real-ming` |
| `owner` | `ming` |

#### Review + create

**Check the estimated monthly cost before you press create.** It should be
single-digit US dollars. If it is not, the size is wrong — go back to Basics.

### Step 3 · Key Vault (you)

Portal → **Create a resource** → **Key Vault**, into the `real-ming` group,
Southeast Asia, name `real-ming-vault`.

Then **Access control (IAM)** → grant the VM's managed identity the
**Key Vault Secrets User** role. That is what lets the service read its own
credentials without any secret living on the disk.

### Step 4 · Tell me the names (you)

Reply with the VM's public IP and the vault name. **Not the secrets.**

### Step 5 · Load the ten credentials (you)

For each name in `CREDENTIAL-INVENTORY.md`, Key Vault → **Secrets** →
**Generate/Import**. Use the same names, lowercased with hyphens, for example
`REAL_MING_NOTION_TOKEN` becomes `real-ming-notion-token`.

Paste values from your `.env`. Do not send them to me, and do not put them in a
GitHub issue.

### Step 6 · Everything else (me)

Once Steps 1–5 are done I will:

- containerise the service so day 31 is a migration, not a rewrite
- write the systemd unit that runs the scheduler and the Telegram front door
- read credentials from environment variables, with a small optional Key Vault
  loader for Azure, so no other host needs that loader at all
- put the SQLite state on the managed disk and add a **daily backup** to Azure
  Storage — your 30 migrated Work Items live in that one file
- add the deployment scripts and an opt-in live smoke test to the repository
- prove the acceptance criteria and close the ticket

---

## Test cases

| Test | Expected result |
| --- | --- |
| Shut the Lenovo, send a Telegram message | Real-Ming answers |
| `systemctl restart real-ming` at midday | No second brief or roll-up that day |
| Restart after creating a Work Item | Still present, with its audit trail |
| Open the dashboard | Scheduler health shows last and next run, no secret |
| `journalctl -u real-ming \| grep -i token` | Nothing |
| Run the live smoke test without its flag | Skips rather than contacting a provider |
| Delete the VM and restore from backup | State returns to the last backup |

---

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Brief arrives twice in one day | Two hosts run the scheduler. Stop one — the occurrence claim guards one database, not two. |
| Service will not start | Managed identity is missing the Key Vault Secrets User role. |
| State empty after a restart | The state file is outside the managed disk mount. |
| Telegram silent while the laptop sleeps | The VM is stopped, or `REAL_MING_TELEGRAM_BOT_TOKEN` is missing from the vault. |
| A credential appears in a log | Stop. Rotate it in Key Vault, then find the line — `AGENTS.md` forbids credentials in logs. |
| Cost rising after 30 days | The credit expired. Expected — the budget alert from Step 1 is what tells you. |
