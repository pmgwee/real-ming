# RM-40 · The unattended cron defect, and the DuitSini tracer

Executed 7 September 2026, 03:41–04:10 UTC (11:41–12:10 KL) on
`real-ming-control-plane-my`.

## TL;DR

**Native cron could never have run unattended.** The ticker fired exactly on
schedule and every run failed to dispatch. Manual `hermes cron run` kept working
because it executes in the CLI's own process, so the cutover looked complete and
would have delivered nothing tonight. Found by scheduling a throwaway probe
rather than waiting for 21:30.

**The DuitSini tracer passed**, and the repository never needed a credential —
it is public. Read-only clone, real diagnosis, real diff, real test run.

## The cron defect

### How it surfaced

Rather than wait ten hours for the 21:30 roll-up, a throwaway job was scheduled
three minutes out with `--deliver local`, so it could fire unattended without
messaging Ming. It fired on time and failed:

```
11:50:53 +08:00  failed  source=builtin
  Restart-safe cron worker dispatch failed: cannot create restart-safe
  systemd scope for gateway child: systemd-run --user --scope is unavailable
```

`tools/process_registry.py:339` requires `systemd-run --user --scope` whenever
the gateway is a supervised systemd process. Its own docstring names this case:
*"in system-service deployments (and containers) the user D-Bus session bus that
`systemd-run --user` needs may be absent."*

### Three layers, each hiding the next

| Attempt | Result |
| --- | --- |
| `loginctl enable-linger real-ming` — create a persistent user manager | `/run/user/999` appears on the host; a manual `systemd-run --user --scope` probe as `real-ming` succeeds |
| Add `Environment=XDG_RUNTIME_DIR=/run/user/999` to the unit | Variable present in the process, run **still fails** |
| Add the path to `ReadWritePaths` | **Still fails.** Inside the service's namespace `/run/user` is `d---------`, an inaccessible empty directory |
| `BindPaths=/run/user/999` | systemd resolves it, and **the mask still wins** |

The cause is `ProtectHome=true`. It masks `/home`, `/root` **and `/run/user`** —
and `/run/user` is exactly where the user D-Bus lives. Neither `ReadWritePaths`
nor `BindPaths` undoes that masking.

### The fix

```
ProtectHome=false
InaccessiblePaths=/home /root
BindPaths=/run/user/999
Environment=XDG_RUNTIME_DIR=/run/user/999
```

This keeps the actual intent — `/home` and `/root` unreadable — without hiding
the bus. The service account's home is `/var/lib/hermes-real-ming`, not under
`/home`, so nothing is lost. Verified inside the running service's namespace:
the runtime directory is writable and `ls /home` returns nothing.

`loginctl enable-linger real-ming` was added to
`deploy/azure/prepare-malaysia-host.sh`, and the deployment preflight now
asserts all three directives, so a rebuilt host cannot lose this silently.

### Proof the fix works

The next unattended fire produced a **different** error:

```
12:05:14 +08:00  failed  RuntimeError: HTTP 429: The usage limit has been reached
```

The worker dispatched, started, and reached the model API. That is the dispatch
path working; the remaining failure is unrelated.

## The usage limit — relevant tonight

```
openai-codex #1  oauth  device_code
  rate-limited  usage_limit_reached (429)  (4h 27m left)
```

Today's testing consumed the Codex subscription limit: 48 `gpt-5.6-sol` calls
(539,860 input tokens) and 4 `gpt-6-astra`. The cooldown expires around
**16:33 KL**, comfortably before the 21:30 roll-up. No action needed, but if a
scheduled report ever fails with 429 this is why.

The throwaway probe was deleted. Both real jobs remain, unchanged:
07:30 and 21:30 at `+08:00`.

## The DuitSini tracer — and a correction

**Earlier I recorded this as blocked on a credential. That was wrong.**
`pmgwee/DuitSini` is **public**, so a read-only clone needs no credential at
all. Only a push or pull request would.

A shallow clone at `1a936f8` gave a real Next.js application: 17 test files,
`vitest run`, 209 packages installed. Baseline: **106 passed, 2 failed**, exit 1.

### Task one — judgment, not patching

The agent was asked to diagnose the two failures and fix **only** genuine
defects, explaining rather than weakening any assertion that was merely
environmental.

It changed nothing, and was right to. It identified both as Windows-specific:
`codexAuthPaths` uses `node:path.join`, which follows the host OS, and its
deduplication is gated on `process.platform === "win32"`; the CLI test expects
`claude.cmd` where Linux correctly yields `claude`. It proposed running them on
Windows or injecting the platform, and explicitly refused to weaken the expected
Windows path.

Verified independently: the tree was clean, and
`lib/bridge/member-bridge-template.ts:497` does read
`process.platform === "win32" ? "claude.cmd" : "claude"`.

It also found an unrelated real defect: `tests/music-llm-smoke.test.ts` reads
`.env` with `readFileSync` at import time, so the suite fails to load on any
machine without one even though those tests are opt-in and would skip.

### Task two — the real diff

Asked to fix what it found, minimally:

```diff
-import { readFileSync } from "node:fs";
+import { existsSync, readFileSync } from "node:fs";
@@
-for (const raw of readFileSync(`${process.cwd()}/.env`, "utf8").split(/\r?\n/)) {
-  const m = raw.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
-  if (m && process.env[m[1]] === undefined) {
-    process.env[m[1]] = m[2].replace(/^"|"$/g, "").trim();
+if (existsSync(`${process.cwd()}/.env`)) {
+  for (const raw of readFileSync(`${process.cwd()}/.env`, "utf8").split(/\r?\n/)) {
+    const m = raw.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
+    if (m && process.env[m[1]] === undefined) {
+      process.env[m[1]] = m[2].replace(/^"|"$/g, "").trim();
+    }
   }
 }
```

One file, minimal, correct. Final run: **106 passed, 2 failed, 4 skipped**,
exit 1 — still 1, because it honestly left the two Windows tests alone.

Nothing was committed and nothing was pushed. The change sits in the working
tree at `/var/lib/hermes-real-ming/workspaces/duitsini` for Ming to review or
discard.

**What a push would need** is a write-scoped credential in the Hermes
environment. That is a separate decision from the read-only tokens already
outstanding, and it is not requested here.
