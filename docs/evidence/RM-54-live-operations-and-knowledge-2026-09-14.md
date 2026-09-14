# RM-54 — live operations and role-scoped native knowledge

**Date:** 14 September 2026
**Issue:** [pmgwee/real-ming#54](https://github.com/pmgwee/real-ming/issues/54)
**Branch:** `codex/live-operations-and-knowledge`
**Ticket base:** `ef49bef`
**Implementation commit:** `c4ee6eb` — *feat(operations): capture governed work from native Hermes*
**Backup hardening commit:** `8a43628` — *fix(backup): include live native knowledge state*

This record states what was expected and what was actually observed on the
production host. It is engineering evidence, not a CEO action item; nothing in
this file asks Ming to do anything.

---

## 1. What went live, and what deliberately did not

Two different systems share the word "knowledge" in this repository, and
conflating them would misreport the rollout.

| System | State after RM-54 |
| --- | --- |
| **Role-scoped selective native knowledge** — governed generation/publication, role and Trust-Domain-gated retrieval, restore-safe forgetting, native Hermes invocation | **Live**, with the production evidence in §4 |
| **Recurring knowledge consolidation** — the `02:00 Asia/Kuala_Lumpur` job | **Deliberately disabled.** Still an inactive manifest, still not a cron row. Enabling it remains a separate CEO decision |
| **Legacy six-root encrypted Curated Knowledge Vault + Projection Broker** | **Unchanged: retained, optional, no production caller.** `REAL_MING_OBSIDIAN_ROOTS` is unset and none of the six roots exist. RM-54 did not activate any part of it |
| **Local Obsidian mirror transport** | **Not approved, not built, absent** |

Work Items and their lifecycle, and Notion task coordination, are also live —
see §3.

---

## 2. Production checkpoint

| Element | Value |
| --- | --- |
| Host | `real-ming-control-plane-my` (Azure, Malaysia West) |
| Production repository | `/var/lib/hermes-real-ming/repos/real-ming`, detached at `c4ee6ebde16060984c2976ecbf6a05904ce23b14` |
| Deployed image | `real-ming:v6-c4ee6eb` |
| Native Hermes | v0.21.0, pinned source `/opt/hermes-agent-561b053f`, commit `561b053f794a1781868bb032029d589c67708119` |
| Hermes home | `/var/lib/hermes-real-ming` |
| Real-Ming extension | `/opt/real-ming-extension` |
| Native-knowledge registry | `/var/lib/real-ming/native-knowledge.sqlite` |
| Generated/staging root | `/var/lib/hermes-real-ming/obsidian-vault/.real-ming` |

---

## 3. Work Item lifecycle and Notion projection

Native Hermes invoked the governed `real_ming_capture_work_item` tool in
production. Capture runs the existing `OperationsGateway` lifecycle and the
`MasterTasksProjection`, not a second or bypass path.

| Expectation | Observed |
| --- | --- |
| Native Hermes can capture a Work Item through the governed tool | Work Item `8d78fde1-45b3-4377-b89b-dd04d38636cc` created |
| Intent recorded verbatim | `[Live acceptance #54] Verify native Hermes Work Item and Notion projection` |
| Lifecycle state is `Captured`, not executed or completed | State `Captured` |
| Role and workstream metadata recorded | `CTO` / `MicroSaaS` |
| The call reaches the real Notion provider, not a local queue | Notion page `3db89b83-bac5-81b6-8b28-df768d840c9e`, board category `Pending` |
| Exactly one Notion version for the item | Version count 1 |
| Replay on the same idempotency key is a read, not a duplicate | Idempotency key `rm54-live-work-item-notion-v1` replayed and returned the **same** Work Item ID with `deduplicated: true` |

The capture call waits for the provider projection to complete. A failed
projection would have failed the call, so this is production-write evidence
rather than a local queue assertion.

---

## 4. Role-scoped selective native knowledge

| Expectation | Observed |
| --- | --- |
| A generation can be staged and activated through the governed path | Initial generation `native-knowledge-generation-27494686-f4a7-4aa9-80a8-5ff846c09b09`; current active generation `native-knowledge-generation-cb09e3ed-3e95-46ec-ac4a-4592cd762115` |
| Native Hermes retrieves a cited page through the production MCP surface | Citation `issue:54/live-acceptance-live` retrieved, Trust Domain `Ming Creatives` |
| An unauthorized role is refused, not quietly served | A `Personal CFO` request for `Ming Creatives` was **refused as unauthorized** |
| Forgetting is restore-safe and recorded against an independent head | Forget subject `rm54-live-acceptance-alpha`; suppression epoch 1, tombstone-head epoch 1, result `restore-safe` |
| The tombstone head is genuinely independent of the registry | The Azure tombstone head object was read and written through managed identity |
| Retrieval stays continuous after a forget | Retrieval continuity succeeded after forgetting the alpha subject |
| Registry health after the run | Publication epoch 2, tombstone epoch 1, tombstone-head epoch 1, repair state `healthy` |
| The pinned one-shot wrapper stays inside its allowlist | Completed successfully **twice** using only the four permitted operations: list candidates, read source, stage generation, wiki retrieve |

### Safe failure retained as evidence

The first fixture attempt **failed safely**: its content hash lacked the
required `sha256:` prefix, so nothing was activated. Its registry is retained
at `/var/lib/real-ming/native-knowledge.failed-rm54.sqlite`.

This is a guard working as designed. It was not an outage, it did not affect
Telegram or any other service, and the file is kept deliberately.

---

## 5. Telegram delivery

| Expectation | Observed |
| --- | --- |
| The production Telegram delivery path works end to end | Scheduled native Hermes acceptance job completed; delivery ledger recorded `delivered` with no error |
| Job identity | Job ID `c6473873c347` |
| Execution identity | Execution ID `e5216e8376bd44d4bf690421508cd7f1` |
| Completion | 2026-09-14 12:40 Malaysia time |
| No temporary job is left behind | The temporary acceptance job was removed; see §7 |

No further acceptance message was sent. Re-proving a proven path costs a real
message to a real person for no new information.

---

## 6. Protected backup and recoverability

The backup change in `8a43628` passes
`REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH=/var/lib/real-ming/native-knowledge.sqlite`
into the backup container, so the live registry enters the protected set.

**Installation.** The committed script was transferred LF-clean, syntax-checked
with `bash -n`, and diffed against the installed copy before replacement: the
diff was exactly the one added line, with no unrelated drift. The systemd unit's
real script path was confirmed first — `real-ming-backup.service` runs
`ExecStart=/usr/local/libexec/real-ming-backup`. The previous script is retained
at `/usr/local/libexec/real-ming-backup.pre-rm54` for rollback.

**Why this mattered.** The live registry is in WAL mode: the main database file
was 4 KB while its `-wal` sidecar held 304 KB of the actual RM-54 state. A raw
file copy would have produced a technically present but effectively empty
registry. The backup path uses the SQLite online backup API through
`backupSqliteState`, which consolidates WAL content — the backed-up registry is
77 KB, and §6.2 confirms it carries the real rows.

### 6.1 Backup run

| Expectation | Observed |
| --- | --- |
| One protected backup completes | Backup `2026-09-14T04-49-22.092Z`; unit `Result=success`, `ExecMainStatus=0` |
| The manifest includes the native-knowledge registry | `native-knowledge/state.sqlite`, role `native-knowledge-state` |
| The manifest includes tombstone material | `native-knowledge/tombstone-outbox.json`, role `native-knowledge-tombstone-outbox`, schema `real-ming.native-knowledge-tombstone-outbox.v1`, 1 entry |
| The manifest includes the generated wiki tree | 9 files under `hermes-vault/.real-ming/generated/`, covering both generations' `manifest.json`, `log.md`, `index.md` and `pages/` |
| Total protected files | 24 — 1 operations-state, 1 notion-write-ledger, 1 hermes-session, 7 hermes-native-state, 2 hermes-native-file, 10 hermes-native-vault, 1 native-knowledge-state, 1 native-knowledge-tombstone-outbox |
| Staging snapshots are cleaned up | `hermes-native.snapshot` and `hermes-vault.snapshot` both absent after the run |

### 6.2 Isolated restore

The backup was restored into an isolated directory through the supported
restore path, which is the actual recovery route rather than a file listing.

| Expectation | Observed |
| --- | --- |
| The restore verifies every manifested file | `Control-plane restore verified 24 files` |
| SQLite stores pass integrity checks | `11 SQLite stores passed integrity checks`; the registry's own `PRAGMA integrity_check` returned `ok` |
| The recovered registry carries real state, not an empty shell | Active generation `native-knowledge-generation-cb09e3ed-3e95-46ec-ac4a-4592cd762115`, publication epoch 2, tombstone epoch 1, tombstone-head epoch 1, repair state `healthy` — identical to live |
| Generations, tombstones and candidates survive | 2 generations (one `active`, one `superseded`), 1 tombstone (`rm54-live-acceptance-alpha`), 1 outbox entry, 2 candidates — identical to live |
| The generated wiki tree is recoverable | Both generations' pages restored, including `rm54-live-acceptance-live.md` |
| The restore states the tombstone-head reconciliation requirement | `independent head coverage must be reconciled before wiki retrieval is enabled` |

The restore scratch directory created for this check was removed afterwards. No
production data was deleted.

---

## 7. Final production health verification

Read-only, after the backup run.

| Check | Expected | Observed |
| --- | --- | --- |
| Services active | 3 | `real-ming.service`, `hermes.service`, `hermes-dashboard.service` all `active`, each `NRestarts=0` |
| Loopback listeners | 3 | `127.0.0.1:8642`, `127.0.0.1:8787`, `127.0.0.1:9119` |
| Real-Ming MCP tools | 17 | `hermes mcp test real-ming` → `✓ Tools discovered: 17` |
| Ming skills installed | 8 | `cao`, `cmo`, `coo`, `cto`, `knowledge-capture`, `knowledge-consolidation`, `personal-cfo`, `real-ming` |
| MCP servers enabled | 9 | real-ming, deepwiki, context7, notion, vercel, supabase, exa, github, higgsfield |
| Recurring Hermes jobs | exactly 2, both normal | `5a6a8093645a` Real-Ming Morning Brief (`30 7 * * *`) and `03d42efb662a` Real-Ming Executive Roll-Up (`30 21 * * *`), both `[active]`, both last run `ok`. **No temporary acceptance job remains** |
| Recurring consolidation row | absent | absent |

The 17 tools discovered on the host are the same 17 defined in
`src/integration/real-ming-tools.ts`: 4 work-item, 7 native-knowledge, 1
scheduled-report and 5 provider-access.

---

## 8. Incident observed and recovered during rollout

Before the final deployment, `real-ming.service` was restart-looping with
`unable to open database file` while Hermes and Telegram remained healthy. The
service was stopped, its mounted SQLite state passed integrity checks, and it
restarted successfully. The final check showed `NRestarts=0` with all three
services active.

**The underlying stale/open-state cause was not proven and is not claimed
here.** It is recorded as an observation so a recurrence is recognised, not as a
diagnosed and closed fault.

### Rollback assets retained on the host

- `/opt/real-ming-extension.pre-rm54`
- image `real-ming:v6-9ef3fac`
- `/var/lib/hermes-real-ming/config.yaml.pre-rm54`
- `/var/lib/real-ming/native-knowledge.failed-rm54.sqlite`
- `/usr/local/libexec/real-ming-backup.pre-rm54`

---

## 9. Repository gates

Gate results for the final RM-54 diff are recorded in the issue closeout
comment, verified by exit code rather than by reading output.

| Gate | Requirement |
| --- | --- |
| `npm run check` | exit 0 — type-check, tests, build, browser test, deployment preflight |
| `npm audit --audit-level=high` | exit 0 |
| `git diff --check` | exit 0 |

The focused backup test recorded at the handoff checkpoint was re-run and
stayed green:

```
npx vitest run test/system/control-plane-runtime.system.test.ts -t "includes the live native-knowledge registry"
Test Files  1 passed (1)
     Tests  1 passed | 33 skipped (34)
```

---

## 10. Baseline

The **design baseline** is unchanged: **Real-Ming v1.1 · Architecture
Revision 6**. RM-54 activated capability inside that revision; it did not
promote or alter it.

The **deployed revision** is stated separately in
[`docs/BASELINE.md`](../BASELINE.md) and now records image `real-ming:v6-c4ee6eb`,
17 extension tools and 8 skills. Neither label is evidence for the other.
