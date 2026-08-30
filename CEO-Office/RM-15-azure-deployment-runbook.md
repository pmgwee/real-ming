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
| Azure AI Foundry Agent Service | Solves a problem we do not have, and would move your personal context into a vendor runtime, against the Trust Domain design. |

**Is it useful later?** Container Apps becomes the right answer the day state
moves from SQLite to Postgres. That is a real future ticket, not an RM-15
decision, and it should be taken on its own merits rather than smuggled in here.

---

## Steps

### Step 1 · Budget alert — do this first (you)

Portal → **Cost Management** → **Budgets** → **Add**.

- Scope: your subscription
- Amount: **RM250** (the cap in the specification)
- Alerts at 50%, 80%, 100%, to your email

Your $200 credit expires in 30 days. Without this you find out by being charged.

### Step 2 · Resource group and virtual machine (you)

Portal → **Create a resource** → **Virtual machine**.

| Field | Value |
| --- | --- |
| Resource group | `real-ming` (create new) |
| Name | `real-ming-control-plane` |
| Region | **Southeast Asia** (Singapore, closest to you) |
| Image | Ubuntu Server LTS |
| Size | **B1s** — enough for this workload |
| Authentication | SSH public key |
| Inbound ports | **SSH (22) only** |
| Disk | Standard SSD, 30 GB |
| Identity | Enable **system-assigned managed identity** |

Do not open port 80 or 443. The Telegram front door polls outward; nothing
needs to reach in.

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

- write the systemd unit that runs the scheduler and the Telegram front door
- fetch secrets from Key Vault at start-up via managed identity, never to disk
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
