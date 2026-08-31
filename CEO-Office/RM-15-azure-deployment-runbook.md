# RM-15 — Put Real-Ming on Azure

> **TL;DR — the VM, Key Vault, managed identity and ten secrets are complete.**
> The application and deployment package are ready locally. The remaining gate
> is an explicitly approved live deployment, followed by the restart, backup,
> dashboard and Lenovo-off Telegram proofs below.

> **✅ Chosen, 30 Aug 2026:** `Standard_D2as_v5` (2 dedicated vCPU, 8 GiB, AMD
> x86-64), **East Asia**, Ubuntu Server 24.04 LTS Gen2, 128 GiB Premium SSD LRS,
> SSH-only inbound, managed identity on. Southeast Asia refused every small size
> with `NotAvailableForSubscription`; East Asia is the nearest region that works.

---

## Why this cannot be delegated

Steps 1, 2 and 5 spend your money and hold your credentials. I will not create
an Azure account, enter payment details, or type a credential into a console on
your behalf. Everything after that is engineering and I own it.

---

## Prerequisites

- [x] Azure account, active — `126042693@student.newinti.edu.my`
- [x] The Daily Operations scheduler, committed in `dcd00ea`
- [x] Azure VM, managed identity, Key Vault and ten secrets provisioned
- [ ] A budget alert (Step 1)
- [ ] A Blob Storage account/container for off-machine backups (created during
      the approved deployment; it contains SQLite state and must stay private)

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
| Keep paying, as built | roughly **$95–115/month** — around **RM450–540** | Nothing changes, but this is real money |
| Keep paying, resized | roughly **$10–15/month** on a `B1s` | Nothing changes; the workload never needed `D2as_v5` |
| **Migrate to GCP** | Free — you hold **RM1,318** in credit, roughly 8–12 months of a small machine | An afternoon of work, if we build for it now |
| Stop | Free | Real-Ming goes back to running only when the Lenovo is awake |

**A correction to what this table said before.** It quoted RM50/month against a
`B1s`, which was the size assumed when the choice was first written. You then
chose `D2as_v5` — correctly, because the trial credit makes the larger machine
free for thirty days and the experience is worth having. But the consequence
followed the size: 2 vCPU and 8 GiB with a 128 GiB premium disk and a static
public IP is roughly **ten times** the running cost of the machine this table
was describing, and it is well above the RM250 cap the specification sets for
Metered Platform Cost.

That does not make the choice wrong. It makes "keep paying, as built" the option
you would not want to pick by default on day 31. The workload — one Node
process, a SQLite file, three scheduled jobs a day, no model inference anywhere
in the codebase — has never needed more than a `B1s`. Resizing is a slider in
the portal, not a migration.

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
- Amount: **RM250** (the Metered Platform Cost cap in the specification)

  This is a tripwire, not a sizing constraint. It exists so that the moment the
  trial credit stops absorbing the bill, you hear about it from an alert rather
  than from a charge.
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
| Region | **East Asia** — Southeast Asia refuses these sizes for this subscription |
| Availability options | Availability zone *(or "No infrastructure redundancy required" — either is fine for one VM)* |
| Zone options | Self-selected zone |
| Availability zone | Zone 1 |
| Security type | Trusted launch virtual machines — **switch to Standard if it blocks the B-series size** |
| Image | **Ubuntu Server 24.04 LTS - x64 Gen2** |
| VM architecture | x64 |
| **Size** | **`Standard_D2as_v5`** — 2 dedicated vCPU, 8 GiB, AMD x86-64, ~US$87/month. Dedicated rather than burstable, so there are no CPU credits to reason about. |
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
| OS disk size | **128 GiB (P10)** — the tier sets IOPS as well as space, and ~500 IOPS suits building container images on the box |
| OS disk type | **Premium SSD, Locally-Redundant Storage** — SQLite fsyncs on every commit, so lower disk latency genuinely helps. ZRS would double the cost to protect against a zone failure that would take the VM down anyway |
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
| Delete public IP and NIC when VM is deleted | ✅ Checked — otherwise they orphan and bill on after the day-31 migration |
| Enable accelerated networking | ✅ Checked — free, and Real-Ming is network-bound |
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

#### Lock SSH to your own address

The portal creates the SSH rule with `Source: Any`, which means every address on
the internet may attempt to log in. Fix that as soon as the key is proven to
work — prove it first, so a failure afterwards has only one possible cause.

**Networking → Network settings →** click the rule named `SSH`. One field
changes; everything else is already correct.

| Field | Value |
| --- | --- |
| **Source** | **`My IP address`** — the only change |
| Source IP addresses/CIDR ranges | appears once Source changes; confirm it is populated |
| Source port ranges | `*` |
| Destination | `Any` |
| Service | `SSH` |
| Destination port ranges | `22` — greyed out, set by Service |
| Protocol | `TCP` — greyed out, set by Service |
| Action | `Allow` |
| Priority | `300` |
| Name | `SSH` — greyed out, fixed at creation |

The amber "exposed to the Internet" banner disappears when it is right. Prove it
from a second terminal before closing the first.

Malaysian home connections are usually dynamic, so this rule will eventually
reject you after a router reboot. That is the rule working. Return here and
click **My IP address** again. You cannot lock yourself out permanently: the
rule is edited from the portal, not from inside the machine.

### Step 3 · Key Vault (you)

Portal → **Create a resource** → **Key Vault**.

**Basics**

| Field | Value |
| --- | --- |
| Subscription | `Azure subscription 1` |
| Resource group | `real-ming` |
| Key vault name | `real-ming-vault` — globally unique across Azure; if taken, add a suffix and tell me |
| Region | **East Asia** — the same region as the VM |
| Pricing tier | **Standard** |
| Days to retain deleted vaults | **7** |
| Purge protection | **Disabled** |

**Purge protection must stay disabled, and it is irreversible.** Enabled, the
vault survives deletion of its resource group for the full retention period,
which defeats the day-31 teardown below. Retention of 7 rather than the default
90 matters for the same reason: a soft-deleted vault keeps its name reserved,
so 90 days would block reusing the name for the whole trial and beyond.

**Access configuration**

| Field | Value |
| --- | --- |
| Permission model | **Azure role-based access control (RBAC)** |
| The three resource-access checkboxes | all unchecked |

**This is the field that must be right.** Choose the legacy "Vault access
policy" model instead and Step 3's role assignments have nothing to bind to;
the vault has to be reconfigured before the managed identity can read anything.

**Networking**

| Field | Value |
| --- | --- |
| Connectivity method | **Public endpoint (all networks)** |

Access is gated by RBAC and the managed identity rather than by the network. A
private endpoint is more machinery for no gain over a thirty-day trial.

#### Two role assignments, not one

**Access control (IAM) → + Add → Add role assignment**, twice.

| # | Role | Assign to | Why |
| --- | --- | --- | --- |
| a | **Key Vault Secrets User** | Managed identity → Virtual machine → `real-ming-control-plane` | lets the service read its own credentials with no secret on disk |
| b | **Key Vault Secrets Officer** | User → your own account | lets **you** create the secrets in the first place |

**Being subscription Owner does not let you write a secret.** Under the RBAC
model, Owner and Contributor govern the vault as a *resource*; they say nothing
about the data inside it. Without (b) the Secrets blade answers `The operation
is not allowed by RBAC`, which reads like a fault and is not one.

### Step 4 · Tell me the names (you)

Reply with the VM's public IP and the vault name. **Not the secrets.**

### Step 5 · Load the ten credentials (you)

For each name in `CREDENTIAL-INVENTORY.md`, Key Vault → **Secrets** →
**Generate/Import**. Use the same names, lowercased with hyphens, for example
`REAL_MING_NOTION_TOKEN` becomes `real-ming-notion-token`.

Paste values from your `.env`. Do not send them to me, and do not put them in a
GitHub issue.

### Step 6 · Deploy and prove the service (agent, after explicit CEO approval)

The repository now contains the exact package: `Dockerfile`,
`deploy/systemd/real-ming.service`, `real-ming-backup.service`, and
`real-ming-backup.timer`. The application runs as the non-root `node` user,
mounts `/var/lib/real-ming`, reads secrets from Key Vault through the VM managed
identity, and binds the authenticated dashboard to localhost only. The daily
backup briefly quiesces the control-plane service, snapshots both SQLite stores
as one checksummed set, uploads the completeness manifest last, and restarts
the service even if backup fails. This prevents cross-store snapshots from two
different logical moments.

The live gate is deliberately split in two so CEO approval can bind an exact
artifact rather than a movable branch or Docker tag.

#### Step 6A — prepare a candidate (first explicit approval)

The live session will perform these bounded preparation actions, stopping
immediately on drift:

1. Connect to the named VM with the CEO-provided SSH key and verify host identity.
2. Install Docker only if absent; clone and detach at the exact reviewed commit
   SHA named in the approval. Build `real-ming:tracer-1` on the VM, then record
   its immutable `sha256:` image ID. The tag is never used by systemd.
   Run `bash deploy/verify-deployment.sh`, which installs Chromium (the
   dashboard browser test fails rather than skips without it), repeats all
   repository gates, builds the image, loads the production composition inside
   it, and syntax-validates all units with `systemd-analyze verify`.

   It does **not** run the live smoke test. That needs credentials and a
   separate activation approval. An earlier version of this line claimed the
   script "smoke-runs the container"; it ran the smoke CLI without `--live`,
   which prints "skipped" and exits 0 whatever the image contains.
3. Create one private Azure Storage account/container in the existing
   `real-ming` resource group, grant only **Storage Blob Data Contributor** to
   the VM managed identity at the container/storage scope, and write the two
   non-secret names to `/etc/real-ming/backup.env`.
4. Create a checksummed local recovery set from the existing canonical
   `.real-ming-operations.sqlite` (30 Work Items, 58 audit events) and
   `.real-ming-notion-ledger.sqlite` (35 idempotency receipts), then securely
   copy both exact databases to `/var/lib/real-ming/`. They are never committed.
5. Install—but do not start—the three systemd units. Install the reviewed
   backup helper root-owned at `/usr/local/libexec/real-ming-backup` with mode
   `0755`; the unit never executes the mutable checkout. Write the immutable
   image ID to root-owned `/etc/real-ming/release.env` as
   `REAL_MING_IMAGE=sha256:...`.
6. Report the commit SHA, image ID, both database SHA-256 hashes, storage scope,
   and one SHA-256 binding the three unit files plus the installed backup helper.
   Stop for the final activation approval. The backup unit is explicitly ordered
   after `real-ming.service`, so a persistent missed timer cannot race service
   activation at boot.

**Required Step 6A approval sentence:**

> I approve preparation of the RM-15 deployment candidate from reviewed commit
> `<COMMIT_SHA>` on the existing `real-ming-control-plane` Azure VM, including
> creation of one private Azure Storage backup account/container in the
> existing `real-ming` resource group, the narrowly scoped managed-identity
> role assignment, secure transfer of the two named canonical SQLite databases,
> image build, and installation of inactive systemd units. Do not start the
> service or send Telegram messages. Stop on any drift and return the exact
> artifact hashes for separate activation approval.

#### Step 6B — activate the exact candidate (second explicit approval)

Only after the CEO approves the reported commit, immutable image ID, database
hashes, storage scope and unit hashes will the agent:

1. Enable and start `real-ming.service` and `real-ming-backup.timer` using the
   exact `REAL_MING_IMAGE=sha256:...` binding.
2. Run `npm run control-plane:smoke -- --live` on the VM. The same command
   without `--live` must report `skipped` and contact nothing.
3. Prove restart durability, one non-duplicated scheduler occurrence, the
   authenticated dashboard over an SSH tunnel, a local and remote backup, and
   Telegram reachability while the Lenovo application process is off.

No credential value is written to disk, copied into a command, printed to a
log, or sent to GitHub. The backup contains personal operational state, so its
container remains private. The agent will report the storage resource name and
role scope before creation, then the exact proof results after deployment.

**Required Step 6B approval sentence (filled with Step 6A evidence):**

> I approve activation of RM-15 commit `<COMMIT_SHA>`, immutable image
> `<IMAGE_SHA256>`, operations state `<STATE_SHA256>`, Notion ledger
> `<LEDGER_SHA256>`, and systemd unit/helper set `<UNIT_SET_SHA256>` on
> `real-ming-control-plane`, with backup scope `<STORAGE_SCOPE>`. Start only
> those exact artifacts, send one documented Telegram smoke reply, perform the
> restart/dashboard/backup verification, and stop on any drift.

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
| Delete the VM and restore from backup | Work/audit state and Notion idempotency receipts return from the same manifest-bound set |

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
| A charge continues after the VM is deleted | The public IP survives it. The portal's "delete public IP and NIC" checkbox sets the NIC to `Delete` but the IP to `Detach` — verified in the deployment template, `pipDeleteOption: "Detach"`. Delete `real-ming-control-plane-ip` by hand when you tear the VM down. |

## Day-31 teardown

When you migrate off Azure, deleting the VM is not enough. Delete the whole
`real-ming` **resource group** instead — that removes the VM, disk, NIC, network
security group, virtual network, boot-diagnostics storage account **and** the
public IP the template would otherwise leave behind.

Take the SQLite backup first. The resource group deletion is not reversible.
