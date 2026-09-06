# RM-40 · Hermes native capability review

Reviewed: 5 September 2026. Read-only architecture research; no production configuration, bot ownership, credentials, services or provider data were changed.

## TL;DR

**A separate Real-Ming control plane is not necessary just to obtain an intelligent Telegram agent, five role perspectives, connected apps, persistent memory, an Obsidian wiki, schedules, task continuity or an agent dashboard.** Official Hermes already supplies substantial functionality in every one of these categories.

The recommended starting point is **native Hermes + Ming's configuration/skills + configured provider integrations**. Add Real-Ming functionality through Hermes plugins, tools/MCP and dashboard extensions where a specific, tested Ming requirement remains unmet. A small data companion may still be useful; a second agent loop or a mandatory per-message control-plane choreography is not justified by the capabilities reviewed here.

This is a recommendation about the target design, **not a claim that the production bot already uses the native Telegram gateway or that the integrations below are authenticated and working**. Shipping source, enabling a feature, authorizing a provider and passing a live workflow are four different states.

## Evidence boundary and versions

- A read-only SSH command confirmed the installed source checkout is `561b053f794a1781868bb032029d589c67708119`, the pinned Hermes installation previously identified as v0.21.0. Only repository source was inspected; credential files and private conversation contents were not read for this review.
- Official upstream `main` resolved to `d20a8e44755a8e999a2e816ef9f458c438d3e17c` when checked. Both revisions were inspected; source links below are pinned to the installed revision where appropriate.
- The Obsidian, LLM Wiki, Notion and Google Workspace skill files, Kanban reference and web-dashboard reference had identical Git blob hashes at those two revisions. These are not merely new features absent from the pinned installation's source.
- The Telegram adapter and tool-dispatch source had changed upstream. Do not use current documentation as proof of exact installed behavior without a pinned-version test. The inspected hook-reference differences updated source locations; the documented return semantics discussed below were unchanged.
- No live LLM call, provider write, package installation or production cutover was performed. The installed source can include features whose optional dependencies or runtime configuration are not yet present.

## What Hermes already provides

| Need | Official native capability | What remains Ming-specific |
| --- | --- | --- |
| Telegram conversation | Native gateway/Telegram adapter, sender allowlisting, sessions, native command dispatch, typing actions, message formatting, attachments and configurable progress/streaming | Configure one bot owner, choose the appropriate display settings and verify the actual phone experience |
| COO / CTO / CMO / CFO / CAO | Custom skills and personality/context instructions; profiles and native task assignment if separate persistent workers are actually wanted | Define the five perspectives, preferred sources and outcomes. A role name alone is not a reason for a separate service or agent process |
| Personal continuity | Persistent `MEMORY.md`, `USER.md` and SQLite session history/search | Decide what belongs in small always-on memory versus a larger retrieved knowledge vault; back up the state |
| Notion | Bundled Notion API/CLI skill and an optional official-hosted Notion MCP catalog entry | Authorization, shared pages/databases, Ming's legacy task-status meanings and a single write-owner strategy |
| Google Calendar | Bundled Google Workspace skill, Hermes-managed OAuth setup, Calendar support through its wrapper/CLI or bundled Python backend | Consent/scopes, target calendars and reconciliation rules |
| GitHub and coding | Bundled GitHub skill using `gh`, plus native file/shell tools and coding-agent loop | Repo permissions, project instructions, desired branch/review/release boundaries |
| Vercel | Optional official-hosted Vercel MCP catalog entry; an authorized CLI/API path is another option | Validate client authorization and actual tool compatibility; pin release intent. Catalog presence is not a successful OAuth test |
| Obsidian | Bundled filesystem-first Obsidian skill | Resolve the vault path; decide sync and device access. A GUI is not required on the Azure agent host |
| LLM Wiki | Bundled Karpathy-style LLM Wiki skill: ingestion, linked Markdown synthesis, source references, querying and linting | Define Ming's schema and curation rules. Stronger atomic publication/encryption/access guarantees need separate verification or supporting code |
| Scheduled work | Native cron tool/commands, one-shot and recurring jobs, skill-backed jobs, delivery targets and execution history | Select one scheduler owner per job, provider/model settings and business-specific retry/deduplication expectations |
| Durable tasks and coding workspaces | Native SQLite Kanban, task tools, dependencies, review/blocking states, restart reclaim and worktree/scratch/existing-directory modes | Map Ming's Notion/portfolio semantics and preserve existing records; compare acceptance criteria before migration |
| Real-time visibility and management | Native web dashboard, session views, logs, analytics, jobs, skills and plugin extension SDK | A CEO-wide cross-source portfolio/evidence/knowledge-health view may still justify Real-Ming-specific views and read models |

### Telegram: reuse the real channel implementation

The pinned Telegram adapter implements `send_typing()` with Telegram's `send_chat_action`, converts Markdown for Telegram, and contains native attachment and streaming delivery paths. The gateway also has tool-progress handling. These are channel features that should not be reimplemented merely to connect business records to the agent. [Pinned Telegram adapter](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/plugins/platforms/telegram/adapter.py#L8717), [Telegram guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram), [pinned gateway](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/gateway/run.py).

“Native experience” does not mean every feature is always on. Progress can be configured, streaming has transport choices, some richer rendering paths are opt-in, media tools need their own dependencies/providers, and Telegram has its own client/API limits. Test the exact installed version and chosen configuration. A raw model API session is not equivalent to routing through this native Telegram adapter.

Native commands and skills should remain reachable through Hermes's command dispatcher. A command can be handled without an LLM turn; ordinary conversation does not need a Work Item, role assignment or JSON plan envelope. Hermes documents invoking skills from CLI or messaging platforms; custom plugins can also add commands and tools. [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), [plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins).

### Five roles and personalization: configuration before infrastructure

Hermes supports a persistent identity/persona file, session-level personality overlays and custom skills. COO/CTO/CMO/CFO/CAO can therefore begin as five useful perspectives within one assistant. Separate profiles are appropriate only when independently configured, persistent workers are useful—not because there are five labels. Prompted roles are guidance, not access-control boundaries. [Personality](https://hermes-agent.nousresearch.com/docs/user-guide/features/personality), [profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles).

Native memory already persists across sessions, and native session search reads stored conversation history. It would be inaccurate to justify Real-Ming by saying Hermes cannot remember anything without it. A curated knowledge vault is a different layer from small always-in-context preferences or a conversation transcript. [Persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).

### Connected apps: direct integration is a valid architecture

Hermes can discover external MCP tools and make them available alongside its built-ins. Using a provider's existing integration can avoid writing a custom adapter. MCP supplies callable operations; it does not automatically establish Ming's lifecycle semantics, select correct calendars or reconcile conflicting records. Those rules can be instructions for low-risk workflows, or deterministic integration code when reliable repeatability is required. [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), [MCP usage guide](https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes).

- **Notion:** the pinned repository includes a Notion skill and an OAuth-based optional MCP entry. Notion's own documentation supports connecting other compatible clients. Initial human OAuth consent is still required for its hosted MCP; this is different from an existing integration-token API connection. [Pinned skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/productivity/notion/SKILL.md), [pinned catalog entry](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/optional-mcps/notion/manifest.yaml), [Notion connection requirements](https://developers.notion.com/guides/mcp/get-started-with-mcp).
- **Calendar:** the bundled Google Workspace skill explicitly covers Calendar and has setup/authentication and execution scripts. This is a shipped skill plus integration code, not proof that Ming's Azure credentials are already connected to it. [Pinned Google Workspace skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/productivity/google-workspace/SKILL.md).
- **GitHub:** the bundled skill uses `gh` for issues, PRs, review and repository workflows. The pinned MCP catalog code deliberately recommends this route instead of including GitHub's hosted MCP, noting its OAuth-client requirements. GitHub does provide an official MCP server, but MCP is not compulsory when the native skill/CLI path is better suited. [Pinned GitHub skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/software-development/github/SKILL.md), [catalog source](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/hermes_cli/mcp_catalog.py), [GitHub MCP](https://docs.github.com/en/copilot/concepts/context/mcp).
- **Vercel:** the pinned Hermes catalog includes `https://mcp.vercel.com` with OAuth. However, Vercel's inspected connection documentation lists reviewed clients without explicitly listing Hermes. Treat successful interoperability as a live acceptance gate; do not claim “supported in the catalog” means “authorized and working for this account.” An existing scoped Vercel adapter or authorized CLI/API can remain useful if that gate fails. [Pinned Vercel catalog entry](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/optional-mcps/vercel/manifest.yaml), [Vercel MCP requirements](https://vercel.com/docs/agent-resources/vercel-mcp).

### Obsidian and LLM Wiki: both official skills exist

The **Obsidian skill** reads, searches, creates and edits Markdown notes using native file tools and adds wikilinks. It resolves `OBSIDIAN_VAULT_PATH` to an absolute path. It is not a separate database, synchronization service or policy engine. [Pinned Obsidian skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/note-taking/obsidian/SKILL.md).

The **LLM Wiki skill**, also present at the installed revision, is much more relevant than a bare note editor: it specifies schema/index/log files, source capture and hashes, interlinked synthesis, explicit contradictions, cited queries, and health checks. It explains opening the folder as an Obsidian vault. This can cover much of the intended personal knowledge workflow without building a second compiler from scratch. Its behavioral instructions are not equivalent to a transactional, access-controlled publication service. Reuse its curation workflow, then add only the stronger guarantees Ming actually needs. [Pinned LLM Wiki skill](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/skills/research/llm-wiki/SKILL.md).

Do not confuse availability with readiness: choosing paths, establishing backup/sync, populating real notes, testing source citations and ensuring only one publishing owner remain necessary. The reviewed source does not prove the currently configured Real-Ming Obsidian folder is populated or usable.

### Durable work, schedules and dashboard: avoid duplicating native foundations

Hermes's native Kanban is already SQLite-backed, with model-callable task tools, dependencies, comments, review states, crash recovery and workspace handling. The five-role model could use these native primitives if persistent workers are needed. That does not make its statuses automatically equivalent to Ming's existing Work Item/Notion schema; migration needs an explicit mapping. Its trusted-local-host workspace design should not be described as a hardened multi-tenant security boundary. [Pinned Kanban reference](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/website/docs/user-guide/features/kanban.md).

Native cron can schedule agent or script-only jobs and deliver results to chats. Prefer one scheduler for each job; two schedulers triggering the same daily brief would duplicate work. [Cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron).

Hermes also has a web dashboard—not just a terminal client. More importantly, a plugin can add a dashboard tab and authenticated backend routes alongside the gateway/tool extension. A “Real-Ming CEO Office” extension is therefore a credible option to evaluate before maintaining a separate dashboard application. Native operational views and Ming-specific cross-application portfolio views are different requirements, but they need not live in separate products. [Web dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard), [dashboard extensions](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard).

## Integration hooks: useful, but do not overclaim enforcement

The pinned official hook catalog provides the following extension points. These are verified **framework contracts**, not proof that a Real-Ming plugin implements them today. [Pinned hooks reference](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/website/docs/user-guide/features/hooks.md).

| Hook / path | Verified semantics | Architecture consequence |
| --- | --- | --- |
| `pre_tool_call` | Can block, escalate to native approval or modify arguments before normal registered-tool execution | Suitable for narrow supported-operation rules; test native, plugin, MCP, delegated and alternate dispatch paths |
| `post_tool_call` | Observes successful, blocked or failed tool results | Useful event source for a dashboard; redact payloads and persist/reconcile externally if completeness matters |
| `transform_tool_result` | Can replace a model-bound tool result | An available integration point for bounded/redacted results; not automatically enabled |
| `pre_gateway_dispatch` | Can skip/rewrite a non-internal inbound message; callback errors fall through to normal dispatch; internal events skip it | Useful ingress customization, but not a demonstrated fail-closed secret boundary |
| `pre_llm_call` | Runs once per user turn and appends returned context | Good for dynamic personalization; not a pre-every-model-request redaction mechanism |
| `pre_api_request` | Per-provider-attempt observer; return ignored | Do not present it as a request-blocking or request-rewriting policy gate |
| Stream/interim hooks | Observational; bounded queues can drop pending events under pressure | Near-real-time visibility, not by itself a durable audit ledger; do not require full token streams for CEO visibility |
| Session/cron/Kanban hooks | Expose lifecycle and outcome events | Can connect native work to Ming's records without controlling the reasoning loop |

Python callback exceptions can be logged and skipped. The documented timeout failure behavior is more specific: a timed-out `pre_tool_call` callback blocks the tool, while other bounded hooks can fail open. Those details are not interchangeable with “all policy failures always block everything.” The pinned dispatcher also exposes a skip flag for callers that have already fired the tool hook. Coverage must be tested through each actual entry path, not inferred from a hook's name. [Pinned dispatcher](https://github.com/NousResearch/hermes-agent/blob/561b053f794a1781868bb032029d589c67708119/model_tools.py#L1439).

Similarly, approving one shell-tool invocation is not equivalent to independently intercepting every subprocess or network operation inside that shell command. An MCP tool is just another available operation; it cannot force the agent to route all unrelated native tools through that MCP server. Use scoped credentials, filesystem/process boundaries and tested hooks when a stronger boundary is required. This is a design inference from the exposed interfaces, not a claim of an exhaustive security audit.

## Recommended minimum custom scope

1. **Keep native Hermes on the main path:** Telegram gateway, sessions, model provider, command dispatcher, skills/tools and agent loop. Do not require a structured Real-Ming Turn Plan for every message or replace Hermes's final prose.
2. **Package Ming's personalization first:** role skills, preferred sources, writing style, project context and Obsidian/Wiki conventions. These are configuration/content, not automatically separate services.
3. **Reuse native providers and workflows where they pass real scenarios:** configure supported integrations; test native memory, cron, Kanban and dashboard. Retain an existing adapter where it is demonstrably more reliable or better scoped.
4. **Give Real-Ming only concrete remaining jobs:** established Notion-status translation, cross-source reconciliation, selected data projections, durable CEO read models, evidence relationships and precise consequential-action handling if those remain requirements.
5. **Prefer a Hermes plugin/dashboard extension over a new platform:** keep a separate backend only where independent data lifecycle, reliability or existing functionality gives a clear benefit. Do not expose private configuration/secrets in an extension API.
6. **Keep one owner per mutable record/workflow:** bot polling, cron jobs, task authority, Notion write-back and vault publication each need a clear owner. Reuse existing state; do not replace production stores merely because a native equivalent exists.

## Acceptance checks before saying the native-first target is complete

- A single native Hermes gateway owns Telegram; allowlisted Ming can chat and native commands remain available.
- Typing, chosen progress/streaming behavior, readable Markdown/code and attachments work on the real Telegram client.
- A normal question does not create an artificial task; a coding request actually performs file edits and tests using native Hermes tools.
- One persistent conversation survives a restart without confusing it with a fresh API-only session.
- Each required provider has a successful authorized read, and any approved write is idempotent in the intended system of record.
- Native memory, Obsidian and wiki operations use the chosen paths; backup/restore and device access work.
- Native task/schedule behavior is tested against Ming's exact workflow before mapping or retiring existing custom records.
- A CEO view follows a real native run, shows failures and useful evidence, and recovers missing events after restart. It does not require hidden reasoning transcripts.
- Consequential operations follow the selected approval route, including denial, timeout and plugin/backend failure cases.
- No other native capability is silently disabled by the Real-Ming extension. Configuration and unsupported features are reported honestly.

## Bottom line

**Hermes can already do much of what the bespoke Real-Ming system was being asked to do.** The earlier native-versus-custom division should be revised accordingly. Real-Ming's value should be measured by the Ming-specific outcomes it adds—not by how much infrastructure it owns. The best target is a personalized native Hermes experience with the smallest dependable amount of custom integration, not a second hand-built harness in front of Hermes.
