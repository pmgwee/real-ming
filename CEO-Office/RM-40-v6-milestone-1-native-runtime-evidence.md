# RM-40 · Milestone 1 evidence — the native Hermes runtime performs real work

Executed 6 September 2026, 03:23–03:27 UTC (11:23–11:27 Asia/Kuala_Lumpur) on
the Malaysia West host `real-ming-control-plane-my`, over the existing private
Tailscale path. **No Telegram traffic, no bot token, no second consumer, no
service restart, no configuration change, no production data touched.**

## TL;DR

**Native Hermes really codes.** Given a repository with a failing test suite it
ran the suite, searched the source, read the relevant files, applied a patch and
re-ran the suite — 15 tool calls across 27 messages in 58 seconds — and the fix
is correct when verified independently of anything the model said.

**Two real defects were found in the installed version's scripted interface.**
In one-shot (`-z`) mode, session resume does not work at all, and passing a
resume flag additionally discards `--in DIR` and drops the agent into
`$HERMES_HOME`. This is reproducible three different ways. It constrains
scripted and cron usage; it does **not** block the V6 gateway path, and the
session store itself does accumulate multi-turn history.

**A third finding carried over from milestone 0 still needs a decision before
any native Telegram traffic:** the host's `config.yaml` default model points at
OpenRouter while the only pooled credential is Codex OAuth.

## 1. Setup

| Item | Value |
| --- | --- |
| Runtime | Hermes Agent v0.21.0 (2026.8.31), pinned commit `561b053f79…08119` |
| Home | `/var/lib/hermes-real-ming` (the existing Codex OAuth profile — **no re-login was performed**) |
| Model | `gpt-5.6-sol`, provider `openai-codex`, reasoning `medium` — passed explicitly on every invocation |
| Toolsets | `terminal,file,todo` (deliberately narrowed from the enabled set) |
| Workspace | `/var/lib/hermes-real-ming/workspaces/m1-subscription-fixture`, inside the systemd `ReadWritePaths` scope so no confinement was widened |
| Fixture | Disposable git repo, baseline commit `be41a55`, Node 26.8.1 built-in test runner, no dependencies to install |
| Cost | Reported by Hermes as `"cost_status": "included"` on the Codex subscription; 15 API calls in total across four invocations |

The fixture is a small Recurring-Subscription normaliser shaped like DuitSini
work: `monthlyEquivalent(amountMinor, cycle)` with a `MONTHS_PER_CYCLE` table
seeded with two wrong values (`quarterly: 4`, `yearly: 10`). Five tests; the
suite exits 1 at baseline. `AGENTS.md` in the fixture instructs the agent to fix
source and never tests.

## 2. The coding loop — passed

**Prompt:** run the suite, diagnose from the source, fix the source only, re-run,
report the changed lines, the exit status and the pass count. Do not commit.

**Hermes reported:** `quarterly` 4 → 3 and `yearly` 10 → 12 at lines 6–7 of
`src/recurring.js`; final exit status 0; 5 of 5 passing; no test edited; no
commit.

**Independently verified afterwards — this is the evidence, not the claim:**

```diff
diff --git a/src/recurring.js b/src/recurring.js
@@ -3,8 +3,8 @@
 const MONTHS_PER_CYCLE = {
   monthly: 1,
-  quarterly: 4,
-  yearly: 10,
+  quarterly: 3,
+  yearly: 12,
 };
```

- `git status --short` → only `M src/recurring.js`. **No test file was touched**,
  and no commit exists, exactly as instructed.
- A separate `npm test` run by the operator, not the agent → **exit status 0**.
- Native tools actually invoked, read from the session store:
  `terminal` ×6, `search_files` ×5, `read_file` ×3, `patch` ×1.
- Message sequence: `user → terminal → search_files ×4 → terminal ×3 →
  search_files → read_file ×3 → patch → terminal ×2 → assistant`. That is
  run-tests → locate → read → patch → re-run, which is the loop the product
  promises.
- Session `20260906_032359_0e0a85`, workspace `m1-subscription-fixture`,
  27 messages, 15 tool messages, 03:24:00 → 03:24:58 UTC, 11 API calls.

This retires the recorded gap that the only Revision 5 "coding" test asserted a
`workspace.read` **denial**. Requirement **V6-CODE-1** moves from *not proven*
to **live-verified at v0.21.0 on the CLI path**.

## 3. Defect 1 — one-shot mode never resumes a session

Every attempt produced a brand-new session ID with no prior context.

| Invocation | Session created | Prior context available | Working directory |
| --- | --- | --- | --- |
| `-z --in $W` | `20260906_032359_0e0a85` | n/a (first turn) | `$W` — correct |
| `-z --in $W --resume latest` | `20260906_032521_6f1cab` — **new** | none | `$HERMES_HOME` — **wrong** |
| `-z --resume 20260906_032359_0e0a85` | `20260906_032558_2bd670` — **new** | none | `$HERMES_HOME` — **wrong** |
| `-z --in $W -c` | `20260906_032621_d226f2` — **new** | none | `$HERMES_HOME` — **wrong** |

`hermes sessions list` shows all four sessions correctly registered to the
`m1-subscription-fixture` workspace, so the resume flags are not failing to find
a candidate — they are being ignored in one-shot mode. The three resumed
attempts each hold 4 messages and 1 tool call, versus 27 and 15 for the real
loop.

The installed `--in` help text states that combining `--in DIR` with
`--resume latest` or `-c` keeps the session in `DIR` and skips the recorded-cwd
restore. Observed behaviour contradicts that text: the agent ran in
`/var/lib/hermes-real-ming` and, in one case, reported `npm run lint` failing
with `ENOENT` on `/var/lib/hermes-real-ming/package.json`.

**Scope of this defect.** It affects the scripted/one-shot path — `hermes -z`,
and therefore any cron job, evidence harness or automation built on it. It does
**not** demonstrate a problem on the V6 product path, because the gateway keeps
its own persistent per-chat sessions.

**Counter-evidence that the session store itself is sound:** the existing
Revision 5 bridge session
`hermes:real-ming:telegram:b975c9faa09fad67581f40f6` holds **20 accumulated
messages** spanning 05:45:36 → 05:50:20 on 5 September. Multi-turn state
persists; only one-shot resume is broken.

**Consequences to carry forward.**

- Milestone 3's phone matrix must explicitly test follow-up context on the
  gateway path. It cannot be inferred from this milestone.
- Milestone 5 must not build scheduled jobs on `hermes -z` continuity. Use
  native cron and gateway sessions, or make each scripted run genuinely
  stateless.
- Any automation using a resume flag must pass `--in DIR` **and** verify the
  working directory, or set the workspace by an unambiguous mechanism.

**Honest limitation:** this was not root-caused in the upstream source, and no
upstream issue was filed. It is characterised by reproducible black-box
behaviour on this exact installed commit.

## 4. Defect 2 — the default model does not match the available credential

`config.yaml` sets `model.default: anthropic/claude-opus-4.6` with
`base_url: https://openrouter.ai/api/v1`, while `hermes auth` shows exactly one
pooled credential: `openai-codex`, OAuth, device_code.

This has been harmless so far only because the Revision 5 bridge overrides model
and provider on every call through `REAL_MING_HERMES_MODEL` /
`REAL_MING_HERMES_PROVIDER`. **Once the native gateway owns Telegram, nothing
supplies that override.** A native session would start on a default the host is
probably not authenticated for.

**Required before milestone 3 cutover:** set the native default explicitly
through protected configuration to `gpt-5.6-sol` / `openai-codex`, or add the
missing provider credential deliberately. Every invocation in this milestone
passed the model explicitly, so nothing here depended on the broken default.

## 5. Honest failure reporting — passed

When asked to run `npm run lint`, which does not exist, Hermes reported the
actual failure — missing `package.json`, `ENOENT`, exit status 254 — rather than
inventing a result. When asked to recall work it could not see, it said so
plainly instead of confabulating the values. Both are the required behaviour.

## 6. Evidence state after this milestone

| Requirement | Before | After | Scope of the claim |
| --- | --- | --- | --- |
| V6-CODE-1 real coding loop | Not proven | **Live-verified** | CLI path, v0.21.0, one fixture repo. Not the DuitSini repository and not through Telegram |
| Native toolset loading | Assumed | **Live-verified** | `-t terminal,file,todo` honoured; `patch`, `read_file`, `search_files`, `terminal` all executed |
| Codex OAuth health | Recorded 5 Sep | **Re-confirmed 6 Sep** | 15 API calls succeeded; no re-login needed |
| Session continuity | Assumed | **Failed on the one-shot path**; store-level accumulation verified | Gateway continuity remains unproven and is milestone 3 work |
| Native Telegram presentation | Failed at R5 | Unchanged — **not attempted** | Deliberately out of scope here |
| Native behaviour before vs after Ming customization | Not started | **Not proven** | The customization does not exist yet; milestone 4 work |

Nothing in this milestone is production-wired or user-accepted. It proves the
runtime can do the work; it does not prove Ming's product experience.

## 7. Cleanup and rollback

The fixture is disposable and isolated. To remove it and its four sessions:

```bash
sudo -u real-ming rm -rf /var/lib/hermes-real-ming/workspaces/m1-subscription-fixture
```

No service, unit file, credential, network rule or production store was modified,
so there is nothing else to roll back. The four milestone sessions remain in
`state.db` as evidence and can be pruned with `hermes sessions delete <id>`.

## 8. Scope correction, recorded 6 September 2026

An earlier version of this document and of the plan claimed steps 1-5 **and 7**
were proven. Step 7 asks for the ordinary-chat and coding requests to be
rehearsed *with the proposed Ming customization enabled*. That customization
does not exist yet, so only half of step 7 is proven:

| Step 7 clause | State |
| --- | --- |
| No mandatory JSON answer envelope | **Proven** — the CLI path carries no envelope at all |
| No dependency on a Real-Ming record operation for simple chat | **Proven** — Real-Ming was not involved in any of the four invocations |
| The same requests rehearsed with the Ming customization enabled | **Not proven** — the skill pack is milestone 4 work |

The comparison that step 7 actually exists for -- native behaviour before
versus after personalization -- therefore remains outstanding. It belongs to
milestone 4, and this document is not evidence for it.

## 9. Next increment

Milestone 2 — prepare a reversible one-owner Telegram migration. It is
repository work and needs no new authorization: trace the control-plane
composition, separate the daily-operations modes so retained Real-Ming data is
usable without owning Telegram, and prove through the System Harness that the
native-mode composition starts no Telegram poller, does not reinterpret
role-prefixed chat, and creates no Work Item for ordinary questions.

The cutover itself (milestone 3) will be requested separately with a concrete
candidate, checks, expected effects and rollback.
