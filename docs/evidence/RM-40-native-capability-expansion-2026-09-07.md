# Native capability expansion — MCP servers and the git coding loop

**Date:** 7 September 2026
**Host:** `real-ming-control-plane-my` (Malaysia West), Hermes v0.21.0 pinned
`561b053f`
**Decision:** CEO directed installing every server on the agreed list at once,
with no tool trimming and no deferrals.

## What changed

The Hermes gateway went from **one** MCP server exposing 4 tools to **eight**
servers exposing **166 tools**, and the agent gained a working git identity so
it can clone, commit and push.

| Server | Tools | Transport | Auth |
| --- | --- | --- | --- |
| `github` | 47 | `https://api.githubcopilot.com/mcp/` | PAT bearer header |
| `notion` | 42 | `https://mcp.notion.com/mcp` | OAuth 2.1 + DCR |
| `vercel` | 37 | `https://mcp.vercel.com` | OAuth 2.1 + DCR |
| `supabase` | 29 | `https://mcp.supabase.com/mcp` | OAuth 2.1 + DCR |
| `real-ming` | 4 | local stdio | bridge key |
| `deepwiki` | 3 | `https://mcp.deepwiki.com/mcp` | none |
| `exa` | 2 | local stdio (`npx exa-mcp-server` 3.4.1) | `EXA_API_KEY` |
| `context7` | 2 | `https://mcp.context7.com/mcp` | anonymous (rate-limited) |

`higgsfield` (`https://mcp.higgsfield.ai/mcp`) is on the approved list and
pending its interactive OAuth step.

## The git coding loop is unblocked

Milestone 8's DuitSini coding tracer was blocked on *"no repo checkout or git
credential on the host."* Both now exist.

```
user.name           Real-Ming Agent
user.email          91836754+pmgwee@users.noreply.github.com
credential.helper   store
.git-credentials    -rw------- real-ming:real-ming
checkout root       /var/lib/hermes-real-ming/repos/
```

The commit identity is deliberate: the noreply address attributes commits to the
`pmgwee` GitHub account while the author name makes agent authorship visible in
the log, and the CEO's personal email stays out of public commit history.

**Verified, not assumed:**

| Check | Result |
| --- | --- |
| Token identity | `pmgwee` (Gwee Per Ming) |
| Repositories in scope | 43 |
| Clone of a private repo | `pmgwee/real-ming` cloned, HEAD `d0ed310` |
| Push access | `git push --dry-run` returned `Everything up-to-date`, exit 0 — **no write performed** |
| Second-repo reach | `git ls-remote` on `pmgwee/career-hunter` returned refs |

Note what the GitHub MCP is *not*: it is the collaboration layer — issues, pull
requests, CI status, remote code search. Hermes writes code with its **native**
Terminal, File Operations and Code Execution toolsets against a real checkout,
exactly as milestone 1 demonstrated. The MCP could be removed and the agent
would still code; without the git credential it could not.

## Security decisions the CEO made, recorded honestly

Two recommendations were made and overruled. Both are legitimate calls; both are
recorded so they can be revisited rather than rediscovered.

| Recommended | Chosen | Consequence |
| --- | --- | --- |
| Trim Notion 42 → 6 tools; defer Vercel and Supabase | Install everything untrimmed | ~166 tool schemas in every prompt. The CEO's own local Hermes panel measured Notion alone at ~50.8k tokens per call. Risk is context exhaustion and degraded tool selection, not cost — cost was explicitly discounted. |
| PAT scoped to selected repositories | **All repositories** | The token reaches all 43 repos plus future ones. With `Contents` and `Workflows` at write, a leaked token could rewrite every repository owned by the account, CI included. Mitigation is revocation speed. |

The PAT was granted write on Contents, Issues, Pull requests, Actions,
Workflows, Commit statuses and Deployments; read on everything else.
**Webhooks was set to no access** because webhook delivery URLs frequently embed
tokens in the path, making read a credential-disclosure path rather than
metadata. Account-level `Git SSH keys`, `GPG keys` and `SSH signing keys` were
excluded at every level: they let a token provision *further* credentials that
would survive revoking this one.

`Workflows: write` was granted deliberately. Without it every commit touching
`.github/workflows/` is rejected, which obstructs ordinary development. The
cost is that the agent can edit the CI that validates its own work, so the
`npm run check` gate now depends on pull-request review rather than being
structurally out of reach.

## Technical findings worth keeping

**Hermes does not pass its process environment to MCP children.** This was
already established when `API_SERVER_KEY` failed to reach the `real-ming`
extension; it recurred here. A key placed in `/etc/real-ming/hermes.env` is
invisible to an MCP server — values must go in that server's own `env:` block.
The first Exa install failed for a second consequence of the same rule: the
package's `#!/usr/bin/env node` shebang could not resolve `node`, which lives at
`/var/lib/hermes-real-ming/node/bin` and is not on the system PATH. Fixed by
setting `PATH` inside the server's env block alongside the key.

**GitHub does not support dynamic client registration.** `--auth oauth` fails
with `Registration failed: 404`. GitHub requires a pre-registered OAuth app, so
the bearer-token path (`--auth header`) is the correct route; Hermes stores the
token in `$HERMES_HOME/.env` and attaches it as a header.

**OAuth callback ports vary per server.** Notion used `27890`, Supabase
`27891`. Forwarding a single port through SSH is therefore unreliable; pasting
the redirect URL back at the prompt works regardless of port and is the method
to document.

## Not yet live

None of this reaches the Telegram agent until the gateway restarts — it still
sees 4 tools. The restart is being deliberately held until the Google
Calendar/Gmail work lands, so the bot drops once rather than twice.
