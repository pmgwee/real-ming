# Reach the dashboard over Tailscale Serve with Nous OAuth

## Status

Accepted, 8 September 2026. Architecture Revision 6. This decision refines the
dashboard-exposure clause recorded against
[ADR-0020](0020-run-ming-on-the-native-hermes-runtime.md); every other clause of
that decision remains in force. It changes how the native Hermes dashboard is
reached. It does not change what the dashboard is, what it may do, or which
process owns Telegram.

## Context

The supervised Hermes dashboard binds `127.0.0.1:9119`, and its only
authentication was the bind itself: a session token minted at start-up and
injected into the page, safe solely because loopback was the sole way in. An
SSH tunnel was therefore mandatory, and the tunnel *was* the access control.

That is workable from a laptop and unworkable from a phone. The tunnel must be
held open by an SSH client while the page is read in a browser; on iOS the
system suspends the backgrounded SSH app, so the two requirements conflict
directly. The practical answer would have been to buy an SSH client and accept
that the tunnel drops whenever you switch to Safari.

Three findings, all measured on the running host rather than assumed, decided
the design:

**Tailscale Serve forwards the original hostname untouched.** A throwaway echo
server behind Serve received:

```
Host: real-ming-malaysia.tail54f32e.ts.net
X-Forwarded-Proto: https
Tailscale-User-Login: <the authenticated tailnet identity>
```

So proxying alone does not satisfy a Host guard, and the dashboard answered
`400` to that hostname exactly as it did before Serve existed.

**The rejection named its own remedy.** The 400 body reads *"Dashboard requests
must use the bound hostname or the configured public hostname."*
`HERMES_DASHBOARD_PUBLIC_URL` is that configured hostname. Hermes trusts its
exact value in the HTTP Host and WebSocket Origin guards **and engages the auth
gate because the value is non-loopback, even though the socket stays on
loopback**. The gate is not optional: with a non-loopback public URL an auth
provider becomes mandatory, so this configuration cannot accidentally serve
unauthenticated.

**The auth gate covers WebSockets.** Unauthenticated upgrade attempts against
all six dashboard WebSocket routes — including `/api/pty` and `/api/console`,
which are terminals — return `401`. Had they upgraded, the tailnet would have
been offered a shell rather than a dashboard.

The alternative was binding the dashboard to the Tailscale interface directly.
It was rejected: it moves the socket off loopback, contradicts the deployment
preflight that pins `--host 127.0.0.1`, and buys nothing that the public-URL
override does not already provide.

## Decision

**The dashboard stays bound to `127.0.0.1:9119` and is reached over Tailscale
Serve, behind Nous Portal OAuth.**

- `HERMES_DASHBOARD_PUBLIC_URL` is set to the tailnet origin
  `https://real-ming-malaysia.tail54f32e.ts.net`. **Origin only.** The runtime
  appends `/auth/callback` verbatim when rebuilding the OAuth redirect URI, so a
  value carrying the callback path doubles it and every login fails to
  round-trip. A build guard asserts the exact value.
- Authentication is **Nous Portal OAuth**, not a shared password. The dashboard
  can edit configuration, keys, MCP servers and gateway state, which is too
  consequential for a single shared secret with no second factor.
- The OAuth client id lives in `/etc/real-ming/hermes.env` on the host. Only the
  public URL is version-controlled, because a hostname is not a credential.
- **Tailscale Serve, never Funnel.** Serve is tailnet-only; Funnel publishes to
  the internet and stays off. The Serve enablement flow checks Funnel *by
  default* — it must be unchecked.
- No SSH key is placed on any phone, and no existing private key is copied.

Reaching the board requires, in order: a device signed into the tailnet, a
tailnet policy permitting it, a successful Nous OAuth login, and a live session.

## Consequences

**The trust boundary moves.** It was "whoever holds the laptop's SSH key"; it is
now "an approved tailnet device *and* a Nous identity". `BASELINE.md`'s statement
that the dashboard is loopback-only remains literally true — the socket has not
moved — but effective reachability changed, and stating only the bind would be
misleading. The baseline records both.

**This is a net increase in protection, not a relaxation.** Before, anyone who
could open the unlocked laptop and run one SSH command reached the dashboard
with no password at all. Now the same person must also hold a Nous session.

**The SSH tunnel is no longer a fallback for the dashboard.** The registered
redirect URI is the tailnet callback, so a login started at `127.0.0.1:9119`
cannot complete, and the session cookie belongs to the tailnet origin. If Serve
or the tailnet fails, recovery is to remove `HERMES_DASHBOARD_PUBLIC_URL` and
restart the unit, which restores passwordless loopback access in seconds. That
rollback is the documented recovery path, not the tunnel.

**The hostname is now public, permanently.** Provisioning the HTTPS certificate
wrote `real-ming-malaysia.tail54f32e.ts.net` into Certificate Transparency logs,
which cannot be edited. This is accepted: the name is not a credential, the
address is RFC 6598 space and unroutable from the internet, and safety rests on
tailnet membership plus OAuth rather than on the name being unguessable. Anyone
renaming the node should understand that the old name stays logged.

**Phone and laptop hold identical rights.** A Kanban-only mobile surface was
considered and rejected on measurement: `/`, `/kanban`, `/cron` and `/sessions`
return a byte-identical SPA shell, so restricting by path still ships the whole
administration application to the browser. Limiting it would mean a
hand-maintained API allowlist in front of an evolving upstream app — a control
that looks solid and rots quietly. Phone risk is instead managed with tailnet
ACLs, OAuth, session lifetime and device revocation, none of which fracture the
workflow.

**Tailscale's default policy permits all tailnet devices.** An explicit ACL
limiting the dashboard to approved devices is required for the "non-approved
device cannot reach it" property to hold; until it exists, that property rests
on every tailnet device being Ming's own.
