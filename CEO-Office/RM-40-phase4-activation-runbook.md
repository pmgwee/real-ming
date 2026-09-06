# RM-40 Phase 4 activation runbook

> **V6 supersession note · 6 September 2026:** This runbook records the V5 Real-Ming Telegram/API bridge and its activation. For the selected native Hermes gateway architecture, follow [the V6 native-first implementation plan](RM-40-v6-native-first-implementation-plan.md). Start with its developer reconciliation and native baseline; do not repeat completed identity setup by default. Existing audit and rollback information below remains historical evidence.

## TL;DR

The repository now contains the Hermes-first Phase 4 composition. Real-Ming
owns the Telegram polling loop and governance; a private Hermes API server
owns the persistent conversation, Codex OAuth session, reasoning, research and
coding tools. The dashboard renders durable Work Items, provider health and
payload-free Hermes session state. Obsidian export and Hermes session recovery
backup (the Real-Ming mapping plus Hermes native `state.db`) are implemented
but opt-in.

The bounded activation and rollback window are approved. The Malaysia West
candidate is now active. Codex OAuth and Tailscale enrollment are complete.
The CEO Telegram smoke confirmed real Hermes replies but found presentation
and workflow defects. Developer corrections are required before repeating the
acceptance checks; see [Telegram smoke findings](RM-40-phase4-telegram-smoke-findings.md).
Recovery proof and final East Asia deallocation remain outstanding.

## Latest activation audit · 2026-09-05

The CEO-approved Malaysia West green/blue candidate now exists as VM
`real-ming-control-plane-my`: Ubuntu 24.04 Trusted Launch,
`Standard_D2as_v5`, secure boot, vTPM and a 128 GB Premium SSD. Its network
security group has zero custom inbound rules. A public-IP resource exists for
Azure egress and management plumbing, but no public SSH, Hermes or dashboard
rule is open.

The VM managed identity has only `Key Vault Secrets User` at
`real-ming-vault` and `Storage Blob Data Contributor` at the
`real-ming-backups` container. The protected `real-ming-hermes-api-key` now
exists and was retrieved directly into `/etc/real-ming/hermes.env`; its value
was never displayed. The reviewed image from commit
`af75e3c53e6a3befee56595eeee557dc5ddb5dd4` was transferred through the private
backup container and re-verified at the exact image ID
`sha256:6b4bef97bfadb79e34fbe1af9a76f4f2d6e33ba2ab135640084e7db13ca2b5a4`.
Recovery generation `2026-09-04T17-11-44.756Z` passed manifest checks and
SQLite `quick_check` after restore.

Hermes Agent v0.21.0 is installed at pinned commit
`561b053f794a1781868bb032029d589c67708119`. The isolated `real-ming` account,
protected Hermes home, release configuration, backup configuration, systemd
units and CEO-only host-local Obsidian destination are configured. Tailscale
1.102.3 is enrolled. Hermes and Real-Ming are active on Malaysia West, and the
East Asia services are stopped. The final cutover restore used generation
`2026-09-05T05-01-05.634Z` and passed SQLite checks.

### Live execution checkpoint

| Runbook scope | State | Evidence / next action |
| --- | --- | --- |
| Prerequisites | ✅ Complete | Exact image, restore, roles, bridge key, private network and pinned Hermes verified |
| 1. Hermes install | ✅ Complete | Codex OAuth authorized in the protected Hermes home; loopback health and harmless GPT-5.6 Sol proof passed |
| 2. Real-Ming binding | ✅ Active | Protected release values point to loopback Hermes with GPT-5.6 Sol, Codex OAuth and medium reasoning |
| 3. Telegram cutover | 🔄 Connected; acceptance failed | Six answers matched native Hermes records; typing/formatting and workflow integration need correction before full acceptance |
| 4. Obsidian | 🔄 Implementation gap | CEO-only root configured, but production CLI does not enable Knowledge Operations; waiting alone cannot produce an export |
| 5. Dashboard | ✅ Complete | Tailscale device, private SSH tunnel and authenticated dashboard smoke passed; no public port opened |
| 6. Recovery | 🔄 Post-conversation proof pending | Base restore is proven; run a fresh state backup and restore rehearsal after the first successful Hermes conversation |

### Approved activation boundary

The CEO approved the Malaysia West replacement and temporary overlap. After
OAuth, private dashboard and Telegram checks pass, deallocate—but do not
delete—the East Asia VM for rollback. No public dashboard or SSH rule is part
of this approval.

## Why this cannot be delegated

- The Hermes OAuth login binds the production agent to Ming's Codex
  subscription. Never copy the Lenovo OAuth token to Azure.
- Telegram permits one reliable polling owner. Running `hermes gateway` for
  this bot beside the Real-Ming poller races updates and loses the governed
  ingress invariant.
- A dashboard domain requires a DNS, TLS and identity decision; the current
  bearer token is intended for private access only.
- Obsidian materialization writes readable Markdown for the selected Trust
  Domains. Syncing it makes that selection visible to every sync target.
- An Azure Storage role assignment is an external access grant and cannot be
  inferred from code.

## Prerequisites

1. A reviewed Real-Ming image has passed `npm run check`, `npm audit
   --audit-level=high`, and `git diff --check`.
2. The always-on Hermes runtime is in an OpenAI-supported Azure region. The
   current East Asia VM fails this prerequisite; complete the approved
   supported-region green/blue move before attempting OAuth again. Malaysia
   West is the currently validated target because Southeast Asia has no
   capacity for the required VM class.
3. The Azure VM is reachable through the Azure VM agent or the existing private
   SSH/Tailscale path and has a persistent `/var/lib/real-ming` volume.
4. The Hermes binary is installed on Azure at `/usr/local/bin/hermes`, and
   `hermes --version` and `hermes gateway run --help` succeed as the
   `real-ming` service account. Real-Ming uses Hermes's authenticated
   `API_SERVER` gateway; `hermes serve` is the separate desktop/dashboard
   backend and is not the Real-Ming bridge.
5. The 10 existing Real-Ming secrets remain in the approved environment/Key
   Vault path. Add one new Key Vault secret named
   `real-ming-hermes-api-key` (or provide the same value through the protected
   release environment); do not place its value in Git, this runbook, logs or
   Telegram.
6. Decide the host-local Obsidian directory. The conservative first choice is
   an unsynced Azure directory such as `/var/lib/real-ming/obsidian`; if the
   vault must be visible on Lenovo, choose an encrypted sync or an explicit
   pull process separately.

## 1. Install and authenticate Hermes on Azure

Run the following as an administrator on the supported-region Azure VM.
Substitute no secret values into shell history. Do not retry this flow on the
East Asia VM: its OpenAI device-auth request is region-blocked before a user
code can be issued.

1. Ensure the service identity and state directory exist:

   ```text
   if id real-ming >/dev/null 2>&1; then
     sudo usermod --home /var/lib/hermes-real-ming real-ming
   else
     sudo useradd --system --create-home --home-dir /var/lib/hermes-real-ming real-ming
   fi
   sudo install -d -o real-ming -g real-ming -m 0700 /var/lib/hermes-real-ming
   ```

   The repository unit pins `HERMES_HOME=/var/lib/hermes-real-ming`, so the
   service account's OAuth/session/config state stays isolated from both the
   container-owned `/var/lib/real-ming` directory and the host administrator's
   Hermes home. This prevents the Real-Ming container from reading Hermes's
   OAuth material.

2. Install the approved Hermes release for the `real-ming` account. The first
   production tracer is pinned to **Hermes Agent v0.21.0 at commit
   `561b053f794a1781868bb032029d589c67708119`**, the exact revision already
   proven on Lenovo. Authenticate it with:

   ```text
   sudo -u real-ming env HOME=/var/lib/hermes-real-ming \
     HERMES_HOME=/var/lib/hermes-real-ming \
     /usr/local/bin/hermes auth add openai-codex
   ```

   Complete that interactive device flow as the Azure service account so the
   token remains in that account's protected Hermes state. Verify GPT-5.6 Sol
   with a harmless local Hermes conversation. Do not use a copied token, an
   API key pasted into a prompt, or the Telegram gateway mode.

3. Generate a random API-server key in a terminal that will not be logged and
   store it as the Key Vault secret `real-ming-hermes-api-key`. The value must
   be at least 16 characters. Configure the Hermes service file
   `/etc/real-ming/hermes.env` with mode `0600` and this single variable. Do
   not configure a Hermes Telegram platform in this profile; the Hermes
   gateway process below must expose only the private API server so Real-Ming
   remains the one Telegram polling owner:

   ```text
   API_SERVER_KEY=[stored secret value; never commit or print]
   ```

4. Install the repository unit and start Hermes only after the activation
   approval:

   ```text
   sudo cp deploy/systemd/hermes.service /etc/systemd/system/hermes.service
   sudo systemctl daemon-reload
   sudo systemctl enable hermes.service
   sudo systemctl start hermes.service
   ```

5. Verify the private API without exposing the key. The first command checks
   liveness; the second checks authentication using a shell variable loaded
   from the protected secret store, not a literal in this document:

   ```text
   curl --fail http://127.0.0.1:8642/health
   curl --fail -X POST -H "Authorization: Bearer ${REAL_MING_HERMES_API_KEY}" -H "Content-Type: application/json" \
     -d '{"id":"real-ming-health-check","title":"Real-Ming health check","source":"real-ming","system_prompt":"Return a short health-check acknowledgement."}' \
     http://127.0.0.1:8642/api/sessions
   ```

   Expected health output contains `"status":"ok"`. An unauthenticated
   session request must be rejected; the harmless authenticated request must
   be accepted. Remove the shell variable after the check and delete the
   synthetic session through Hermes's normal session administration command if
   your installed release exposes one.

## 2. Bind Real-Ming to the private Hermes API

Set these protected release values on Azure. The API key may be omitted from
the release file when the Key Vault secret above is available; the production
composition resolves it by the variable name `REAL_MING_HERMES_API_KEY`.

```text
REAL_MING_HERMES_ENABLED=true
REAL_MING_HERMES_BASE_URL=http://127.0.0.1:8642
REAL_MING_HERMES_MODEL=gpt-5.6-sol
REAL_MING_HERMES_PROVIDER=openai-codex
REAL_MING_HERMES_REASONING=medium
REAL_MING_HERMES_SESSIONS_PATH=/var/lib/real-ming/hermes.sqlite
REAL_MING_OBSIDIAN_DIRECTORY=/var/lib/real-ming/obsidian
REAL_MING_OBSIDIAN_ROOTS=CEO
```

The `REAL_MING_HERMES_API_KEY` value, if supplied directly, is the Hermes
`API_SERVER_KEY`, not the Codex OAuth token. Real-Ming never reads or copies
the OAuth token. Restart the control plane only in the approved window; its
systemd unit starts Hermes as an optional dependency and passes only the
named, protected configuration variables into the container.

## 3. Telegram ownership cutover and smoke test

1. Confirm no Hermes gateway, desktop bot, or second process is polling this
   Telegram bot. Stop and disable any such process before enabling the
   Real-Ming Hermes path.
2. Confirm the allowlisted CEO Telegram ID and chat ID are unchanged.
3. Restart the Real-Ming service in the approved window and check its private
   logs for names/status only. The dashboard must show Hermes `healthy` with
   zero or more durable sessions; it must not show prompts or chain-of-thought.
4. Send one harmless natural-language question from Ming's allowlisted chat.
   It must receive a Hermes answer. Send one bounded coding request for a
   non-sensitive GitHub project; Hermes may reason and use its configured
   coding tools, while Real-Ming records the Work Item, projections, tool
   decisions and answer. No production merge, deployment, external message,
   financial change or destructive action is implied by this smoke test.
5. Replay the same Telegram update once. The durable turn ID must return the
   same answer without a second Hermes turn or Work Item.
6. Send a credential-shaped test string only if it is safe to do so; the
   expected result is a refusal before Hermes context creation. Never use a
   real credential for this test.

## 4. Obsidian export

After a successful Knowledge Compiler generation, the scheduler exports only
the configured roots (CEO Approved Projections by default) into the configured
host-local directory. The export is atomic, leaves the prior folder as a
recoverable `.previous` copy, and writes a metadata-only manifest. It is a
viewer/IDE, not a Source of Record or policy boundary.

To export more roots, set `REAL_MING_OBSIDIAN_ROOTS` to an explicit comma-separated
list (for example `CEO,Personal`) and review its sync consequences. Do not point the Azure
export at a Lenovo path that disappears when the laptop is off. Do not enable a
sync client until the Trust-Domain/device review is recorded.

## 5. Dashboard access

First inspect the dashboard through the existing private Tailscale/SSH path:

```text
ssh -N -L 8787:127.0.0.1:8787 <azure-user>@<private-azure-host>
```

Open `http://127.0.0.1:8787/` and authenticate with the protected dashboard
token. Verify the Hermes Runtime/Conversations panel, Work Item, provider
health and scheduler sections. A public production domain is a separate
decision requiring DNS, TLS termination, identity-aware authentication,
rate-limiting and a rollback plan; do not publish the bearer-only dashboard.

## 6. Off-host recovery

Create the Azure Storage account/container and narrowly scoped managed-identity
role assignment approved for backups. Configure the existing backup service;
it now includes the Real-Ming `hermes.sqlite` session mapping and Hermes native
`hermes-state.db` when those files exist, uploads the manifest last, and
records backup health. It never copies Hermes `auth.json` or any OAuth
credential. Run one explicitly approved live backup and verify the remote
manifest checksums before relying on the service.

## Test cases and expected results

| Case | Expected result |
| --- | --- |
| `GET /health` on `127.0.0.1:8642` | Hermes API_SERVER reports `status=ok`; no public listener |
| Natural-language Telegram question | Hermes answer delivered through Real-Ming ingress |
| Coding request | Hermes plans/executes its coding loop; Real-Ming records governed Work Item/evidence |
| Duplicate Telegram update | Same durable answer; no duplicate Work Item or Hermes turn |
| Sensitive string | Refusal before model context; no secret in audit/dashboard |
| Dashboard overview | Hermes status/model/session/turn metadata; no prompt or chain-of-thought |
| Knowledge generation | Atomic Obsidian export and metadata-only manifest |
| Backup restore rehearsal | Operations, Notion ledger, Hermes mapping and native Hermes conversation state reopen successfully |

## Rollback

1. Stop accepting new Telegram turns by stopping the Real-Ming service in the
   approved window; do not start a second Telegram owner.
2. Set `REAL_MING_HERMES_ENABLED=false`, redeploy the last reviewed image or
   restart the service, and confirm the dashboard returns to the governed
   non-Hermes behavior.
3. Stop Hermes only after the control plane is disabled or no longer points at
   it: `sudo systemctl stop hermes.service`.
4. Preserve `/var/lib/real-ming/hermes.sqlite`,
   `/var/lib/hermes-real-ming/state.db`, the Obsidian `.previous` folder, and
   the last backup manifest for diagnosis. Never delete them during a rollback.

## Troubleshooting

| Symptom | Safe response |
| --- | --- |
| Hermes health is unavailable | Check `systemctl status hermes`, the loopback API_SERVER binding and the unit journal; do not expose port 8642 or paste the API key into logs. |
| Real-Ming says Hermes API key is unresolved | Confirm the Key Vault secret name or protected release variable; do not add the value to `.env.example` or Git. |
| Telegram messages split or disappear | Stop the Hermes/desktop gateway and leave exactly one Real-Ming polling owner; replay only after the cursor and delivery ledger are inspected. |
| Dashboard shows `failed` | Use the typed failure class and service health, not raw provider text; rotate only through the approved secret path. |
| Obsidian folder is empty | Confirm a Knowledge Compiler generation exists and the configured directory is host-local and writable by the service account. |
| Backup fails after Hermes activation | Confirm `/var/lib/real-ming/hermes.sqlite` and `/var/lib/hermes-real-ming/state.db` exist (the native file may be absent before the first turn) and the backup destination is new; local state remains retained for recovery. |
| Codex device-code request returns `unsupported_country_region_territory` | Stop. Confirm the Azure region and egress location. Move the runtime to an OpenAI-supported region; never copy an existing OAuth token or add an egress proxy to bypass the restriction. |
