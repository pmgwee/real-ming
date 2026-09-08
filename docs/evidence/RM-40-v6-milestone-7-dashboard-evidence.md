# RM-40 · V6 Milestone 7 — private dashboard native-gateway boundary

Executed 6 September 2026 in the repository. This is controlled engineering
evidence; it is not evidence that Ming has completed the private-device review
or that the native Hermes dashboard has been enabled on the Malaysia host.

> **Historical boundary:** the native dashboard was subsequently enabled and
> the two dashboards were compared privately on 7 September. Native cron also
> has a later live ownership record. Use the [comparison evidence](RM-40-v6-milestone-7-comparison-2026-09-07.md)
> for the current dashboard boundary and review status.

## What changed

- The Real-Ming read model now exposes an optional, payload-free
  `nativeHermes` status for the Revision 6 composition. It reports only
  `native-hermes-gateway`, health, configured model, check time and a
  secret-safe failure message.
- The dashboard server obtains that status from the authenticated Hermes
  health seam when native Hermes owns Telegram. It does not create a legacy
  `HermesConversationOverview`, copy native sessions into Real-Ming, or render
  prompts, provider payloads or chain-of-thought.
- The page labels the legacy Hermes conversation table separately and adds a
  Native Hermes Gateway section. In native mode the two views cannot be
  mistaken for one another.
- Legacy Real-Ming ingress mode remains unchanged: its existing coordinator
  view is still used, while the native row is explicitly `not-configured`.
- Added a supervised `hermes-dashboard.service` that binds the native
  dashboard to loopback `127.0.0.1:9119`, requires the Hermes gateway, restarts
  on failure and is included in the deployment/preflight/backup-unit contract.
  It is staged in the repository only; installing it or adding a private
  Tailscale route remains a live approval action.

## Controlled result

`test/system/native-gateway-composition.system.test.ts`: **6/6 passed**,
including a production-composition read of a healthy native gateway with
`hermes` absent, native model `gpt-5.6-sol`, and the injected Kuala Lumpur
timestamp preserved. Existing dashboard/browser coverage remains required.

## Live acceptance still required

1. From an authorized Tailscale device, inspect the native Hermes dashboard
   using the installed version's documented private binding. Keep public SSH
   and dashboard ports closed.
2. Inspect the Real-Ming private dashboard and confirm the Native Hermes
   Gateway row agrees with the native dashboard's health/model, while session
   counts and native command/tool details remain in Hermes' own view.
3. Exercise one simple answer, one slash command, and one bounded coding task;
   correlate the native session/task/artifact with the Real-Ming Work Item,
   evidence and scheduler read models. Do not treat a static healthy endpoint
   as work evidence.
4. Review failed/restarted work and verify the dashboard shows the durable
   state after refresh/restart without retaining secrets or hidden reasoning.

Milestone 7 is therefore **implemented at the read-model boundary and
controlled-tested, but not live-verified or CEO-accepted**.

## Live native-dashboard observation · 6 September 2026

The installed Hermes dashboard was started temporarily on the Malaysia host at
`127.0.0.1:9119` and reached only through the existing private SSH tunnel. No
public listener or Tailscale Serve route was added. The visible dashboard showed:

- Hermes gateway **Running**, version **0.21.0**;
- Telegram **Connected** and one configured channel;
- 14 sessions in the store, 181 messages and 3 sources at the time of review;
- 59/59 skills enabled, including the six Ming playbooks, `real-ming`,
  `obsidian` and `llm-wiki`;
- one enabled MCP server named `real-ming`, using its stdio extension; and
- zero native cron jobs configured.

The separate Real-Ming dashboard remains loopback-only at `127.0.0.1:8787` and
returns `401 Unauthorized` without the protected CEO credential. A
side-by-side comparison of its authenticated overview against the native
dashboard, plus the CEO review of durable running/failed/completed work, is
still pending. The native dashboard process is a temporary acceptance surface;
its presence does not change the Hermes systemd gateway ownership.

The protected `control-plane-smoke-cli.js --live` was then run inside the
running Real-Ming container. It resolved the existing server-side credential,
read the authenticated `/api/overview` endpoint and exited **0** with
`Control-plane live smoke passed.` It emitted no token or overview payload.

## Live deployment update · 7 September 2026

Decision 1 installed and enabled the supervised `hermes-dashboard.service` on
Malaysia West. The native dashboard now runs continuously on loopback
`127.0.0.1:9119` and returned HTTP 200 after the V6 restart; Real-Ming remains
authenticated and loopback-only on `127.0.0.1:8787` (HTTP 401 without its
bearer). The [deployment evidence](RM-40-v6-deployment-evidence-2026-09-07.md)
records the image and service checks. The authenticated side-by-side
comparison and Ming's CEO outcomes review remain pending, so this does not
close milestone 7.
