# Credential inventory

The ten credentials required for the Daily Operations tracer. This file records **no secret values** - only the variable name, who owns it, what it is for, where it lives, and how to revoke it. That is exactly what [issue #7](https://github.com/pmgwee/real-ming/issues/7) requires.

Step-by-step provisioning instructions are in [GATE-1-provisioning-runbook.md](GATE-1-provisioning-runbook.md).

Generated from `src/config/tracer-secrets.ts`. A test fails the build if this table drifts from the code, or if any tracked file ever contains credential-shaped material.

| Variable | Owner | Purpose | When | Environment | Revocation |
| --- | --- | --- | --- | --- | --- |
| `REAL_MING_TELEGRAM_BOT_TOKEN` | CEO | Authenticate the private Telegram front door. | Provision during Gate 1 | control-plane | Revoke with /revoke in BotFather, then issue a new token. |
| `REAL_MING_TELEGRAM_CEO_ID` | CEO | Allowlist the single numeric Telegram identity that may command Real-Ming. | Provision during Gate 1 | control-plane | Replace the allowlisted identity and redeploy configuration. |
| `REAL_MING_NOTION_TOKEN` | CEO | Read and write Master Tasks and the linked Work Views. | Provision during Gate 1 | control-plane | Delete the internal integration in Notion settings. |
| `REAL_MING_NOTION_MASTER_TASKS_ID` | CEO | Identify the canonical Master Tasks data source. | Produced by RM-09; leave empty until then | control-plane | Unshare the data source from the integration. |
| `REAL_MING_GOOGLE_CLIENT_ID` | CEO | Identify the Google authorization client for Calendar. | Provision during Gate 1 | control-plane | Delete the OAuth client in the Google Cloud console. |
| `REAL_MING_GOOGLE_CLIENT_SECRET` | CEO | Authorize the Google Calendar client. | Provision during Gate 1 | control-plane | Rotate the client secret in the Google Cloud console. |
| `REAL_MING_GOOGLE_REFRESH_TOKEN` | CEO | Maintain delegated Calendar access without re-consent, scoped to calendar.events and calendar.calendarlist.readonly only. | Provision during Gate 1 | control-plane | Revoke access from the Google Account permissions page. |
| `REAL_MING_DASHBOARD_TOKEN` | CEO | Authenticate the CEO to the operations dashboard. | Provision during Gate 1 | control-plane | Replace the stored token; sessions fail closed immediately. |
| `REAL_MING_VAULT_KEY` | CEO | Derive the Knowledge Vault encryption key. | Provision during Gate 1 | control-plane | Re-key the vault and republish each root generation. |
| `REAL_MING_WORKER_SHARED_SECRET` | CEO | Authenticate the Lenovo private worker to the control plane. | Provision during Gate 1 | private-worker | Rotate the shared secret on both the worker and control plane. |

## Where the control plane runs

Recorded 28 August 2026 as part of RM-06.

| | |
| --- | --- |
| **Today** | Ming's local machine, with values in a gitignored `.env` at the repository root. |
| **Secret storage** | The same `.env`. Never committed; `.gitignore` carries `.env` and `.env.*` with `!.env.example` as the sole exception. |
| **Still to choose** | A genuinely always-on host. Deferred to RM-15, *Run Daily Operations in the always-on environment*, which is where it first matters. |

RM-07 through RM-14 are implemented and verified locally, so the local machine is sufficient for them. RM-15 is the point at which a laptop that sleeps stops being adequate: a 07:30 brief cannot fire reliably from a machine that is closed. The specification deliberately leaves the hosting vendor out of scope, so that choice stays open until RM-15 forces it.

## Handling rules

- Values live only in the authorized secret store or an ignored `.env`. `.env.example` carries names and never values.
- Every credential above is rotatable and revocable without a code change; the application reads names, never literals.
- No value may appear in Git, GitHub issue content, test fixtures, logs, or any model prompt.
- Verify provisioning with `npm run secrets:preflight`, which reports present and missing **names** only.

## If a credential leaks

Revoke it at the provider first using the procedure above, generate a replacement, then update `.env`. No code change is required.
