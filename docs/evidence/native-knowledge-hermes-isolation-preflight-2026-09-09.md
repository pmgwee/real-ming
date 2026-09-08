# Native Hermes knowledge-job isolation preflight

Date: 2026-09-09 02:18 Asia/Kuala_Lumpur  
Evidence state: **controlled-tested; not production-wired, deployed, or live-accepted**  
Scope: Task 0 of the native knowledge-consolidation plan

## Result

The offline hard-gate probe passed for the exact pinned Hermes source object and
returned exit code `0`. The negative compatibility cases all returned exit code
`78` and were rejected. The probe made no provider request, used no credential,
did not start the interactive gateway, and changed only disposable temporary
ACL fixtures.

The local interactive Hermes installation currently has a different checkout
head (`a7198a8855ad98681114ff5138eb01fe132a62e7`). The probe therefore reads
the required commit object directly from that repository's Git object database
(`sourceMode=exact-git-commit-object`); this is **not** evidence that the local
interactive executable or an Azure deployment is running that pin. A separately
authorized deployment must re-run the same probe against its exact checkout and
must fail closed if its runtime head is not the approved pin.

## Pinned source contract

| Check | Observed |
| --- | --- |
| Required commit | `561b053f794a1781868bb032029d589c67708119` |
| Source root inspected | Local Hermes Git checkout selected by `LOCALAPPDATA`/`HERMES_AGENT_SOURCE` resolution; no credential files read |
| `AIAgent` surface | `run_agent.py:467` defines `AIAgent`; `run_agent.py:557` accepts `skip_memory: bool` |
| Forwarding surface | `agent/agent_init.py:602` accepts `skip_memory: bool`; the pinned entry point forwards the value to initialization |
| MCP include filter | `tools/mcp_tool.py:7720-7738` documents and applies `tools.include` as an allowlist; the lazy path repeats it at `7995-8005` |
| Include semantics | An active include is filtered by exact name; no include resolves the backward-compatible full discovered set |

## Effective callable set

The fake/local MCP registry contained the four permitted operations plus the
existing work-item, scheduler, calendar and mail operations. The effective
list was resolved after applying the pinned include behavior, rather than copied
from the request:

```text
real_ming_knowledge_list_candidates
real_ming_read_knowledge_source
real_ming_stage_knowledge_generation
real_ming_wiki_retrieve
```

The following unrelated operations were absent from the effective list and were
rejected by the negative cases:

```text
real_ming_list_work_items
real_ming_run_scheduled_report
real_ming_list_calendar_events
real_ming_search_mail
real_ming_draft_email
real_ming_create_calendar_event
```

The effective set is exactly equal to the approved four-name set. A missing
include, an extra operation, or a full default toolset made the probe ineligible
with exit `78`; there is no permissive fallback.

## Memory, authentication and OS containment

- The disposable agent boundary used `skip_memory=True`, `enabledToolsets=["file"]`,
  a fake/local model, networking disabled, and no credential values.
- The probe returned `authMode=offline-fake-local-no-credentials` and did not
  inherit Telegram, Notion, Calendar, mail, GitHub, Vercel or model API values.
- On Windows, disposable directories were protected with an ACL denying write
  while retaining read/execute. Writes succeeded only below the staging and
  job-session roots. Attempts against native memory, profile, configuration,
  skills, plugins, cron, credentials and an unrelated root were denied.
- The traversal/escape scenario named a parent outside the two writable roots
  and returned exit `78`. A future Linux service must reproduce this boundary
  with the approved service identity and `ProtectSystem=strict` (or its
  equivalent); a named profile alone is not isolation evidence.

## Commands and exit codes

| Command | Exit |
| --- | ---: |
| `node C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js run test -- test/system/native-knowledge-isolation.system.test.ts` (elevated only to launch the bundled Hermes Python interpreter and apply disposable ACLs) | `0` |
| Probe `--scenario valid --json` with `REAL_MING_NETWORK_DISABLED=1` and `REAL_MING_NO_CREDENTIALS=1` | `0` |
| Probe `--scenario missing-skip-memory --json` | `78` |
| Probe `--scenario unsupported-include --json` | `78` |
| Probe `--scenario extra-tool --json` | `78` |
| Probe `--scenario default-toolset --json` | `78` |
| Probe `--scenario missing-auth-separation --json` | `78` |
| Probe `--scenario os-escape --json` | `78` |

No provider calls or credential-shaped values appeared in the test output or
the evidence artifact. This proves the controlled compatibility and containment
contract only. It does not authorize a cron row, a model/provider call, a
deployment, a permission change, or live acceptance.
