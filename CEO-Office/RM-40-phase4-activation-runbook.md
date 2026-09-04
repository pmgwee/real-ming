# RM-40 Phase 4 activation runbook

## TL;DR

The repository now contains the Hermes-first Phase 4 composition. Real-Ming
owns the Telegram polling loop and governance; a private Hermes API server
owns the persistent conversation, Codex OAuth session, reasoning, research and
coding tools. The dashboard renders durable Work Items, provider health and
payload-free Hermes session state. Obsidian export and Hermes session recovery
backup (the Real-Ming mapping plus Hermes native `state.db`) are implemented
but opt-in.

The remaining steps below are live actions. They require Ming because they
authenticate an always-on runtime, transfer a Telegram bot's operational
ownership, choose where readable cross-domain Markdown is written, or expose
the dashboard to a new network boundary. Do not run them against production
until the exact candidate and rollback window are approved.

## Latest activation audit · 2026-09-04

A read-only Azure VM Run Command check reached `real-ming-control-plane` through
the VM agent. It found the pre-Phase-4 service running on loopback `127.0.0.1:8787`,
but no Hermes installation or `hermes.service`, no `real-ming` Linux service
account, no `/var/lib/real-ming/hermes` or Obsidian directory, and no Phase 4
environment files. The existing `real-ming-backup.timer` is enabled, but its
last `real-ming-backup.service` run exited with status 1. The running container
is an older immutable image, not the current uncommitted Phase 4 working tree.

The Lenovo has no Azure CLI, no SSH agent key, and no matching private key in
the standard SSH directory. The next CEO action is therefore to recover the
existing VM SSH private key or sign in to Azure Portal and keep that session
available for the preparation step. Do not generate a replacement key or
change the network boundary until that choice is recorded.

The authenticated portal check also confirms that `real-ming-vault` contains
the ten existing tracer secrets but not `real-ming-hermes-api-key`. The VM's
managed identity (`real-ming-control-plane`) already has the `Key Vault Secrets
User` role at the vault scope. The `real-ming` resource group currently has no
Storage Account, so the off-host backup target and its blob role assignment
still need a CEO decision and provisioning step.

The VM network security group has zero custom inbound rules and the default
deny-all rule is active. That is consistent with the failed public SSH attempt;
use the recovered private/Tailscale path or the Azure VM agent, and do not open
port 22 or a dashboard port as a shortcut.

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
2. The Azure VM `real-ming-control-plane` is reachable through the existing
   private SSH/Tailscale path and has a persistent `/var/lib/real-ming` volume.
3. The Hermes binary is installed on Azure at `/usr/local/bin/hermes`, and
   `hermes --version` and `hermes gateway run --help` succeed as the
   `real-ming` service account. Real-Ming uses Hermes's authenticated
   `API_SERVER` gateway; `hermes serve` is the separate desktop/dashboard
   backend and is not the Real-Ming bridge.
4. The 10 existing Real-Ming secrets remain in the approved environment/Key
   Vault path. Add one new Key Vault secret named
   `real-ming-hermes-api-key` (or provide the same value through the protected
   release environment); do not place its value in Git, this runbook, logs or
   Telegram.
5. Decide the host-local Obsidian directory. The conservative first choice is
   an unsynced Azure directory such as `/var/lib/real-ming/obsidian`; if the
   vault must be visible on Lenovo, choose an encrypted sync or an explicit
   pull process separately.

## 1. Install and authenticate Hermes on Azure

Run the following as an administrator on the Azure VM. Substitute no secret
values into shell history.

1. Ensure the service identity and state directory exist:

   ```text
   sudo useradd --system --create-home --home-dir /var/lib/real-ming real-ming 2>/dev/null || true
   sudo install -d -o real-ming -g real-ming -m 0700 /var/lib/real-ming/hermes
   ```

   The repository unit pins `HERMES_HOME=/var/lib/real-ming/hermes`, so the
   service account's OAuth/session/config state stays on the persistent Azure
   volume and is not confused with the host administrator's Hermes home.

2. Install the approved Hermes release for the `real-ming` account. The first
   production tracer is pinned to **Hermes Agent v0.21.0 at commit
   `561b053f794a1781868bb032029d589c67708119`**, the exact revision already
   proven on Lenovo. Authenticate it with:

   ```text
   sudo -u real-ming env HOME=/var/lib/real-ming \
     HERMES_HOME=/var/lib/real-ming/hermes \
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
   `/var/lib/real-ming/hermes/state.db`, the Obsidian `.previous` folder, and
   the last backup manifest for diagnosis. Never delete them during a rollback.

## Troubleshooting

| Symptom | Safe response |
| --- | --- |
| Hermes health is unavailable | Check `systemctl status hermes`, the loopback API_SERVER binding and the unit journal; do not expose port 8642 or paste the API key into logs. |
| Real-Ming says Hermes API key is unresolved | Confirm the Key Vault secret name or protected release variable; do not add the value to `.env.example` or Git. |
| Telegram messages split or disappear | Stop the Hermes/desktop gateway and leave exactly one Real-Ming polling owner; replay only after the cursor and delivery ledger are inspected. |
| Dashboard shows `failed` | Use the typed failure class and service health, not raw provider text; rotate only through the approved secret path. |
| Obsidian folder is empty | Confirm a Knowledge Compiler generation exists and the configured directory is host-local and writable by the service account. |
| Backup fails after Hermes activation | Confirm `/var/lib/real-ming/hermes.sqlite` and `/var/lib/real-ming/hermes/state.db` exist (the native file may be absent before the first turn) and the backup destination is new; local state remains retained for recovery. |
