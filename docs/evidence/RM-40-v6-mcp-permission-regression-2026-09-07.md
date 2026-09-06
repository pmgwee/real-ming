# RM-40 · The MCP extension broke silently, and why it was always going to

Found and fixed 7 September 2026, 17:41–17:45 UTC (01:41–01:45 KL, 8 Sep) on
`real-ming-control-plane-my`, during the read-only milestone 5 cron preflight.

## What was broken

`hermes mcp test real-ming` failed:

```
✗ Connection failed (8459ms): Connection closed
```

Running the server directly showed the cause:

```
Error: unable to open database file
  at new OperationsState (.../operations-state.js:168)
  code: 'ERR_SQLITE_ERROR', errcode: 14
```

The extension could not open `/var/lib/real-ming/state.sqlite`. The directory
had reverted to `drwx--S--- azureuser azureuser`; the service account could
neither read the database nor traverse the directory.

**The milestone 5 live evidence was therefore stale.** The tool call recorded in
`RM-40-v6-milestone-5-extension-evidence.md` genuinely happened, but the
capability had stopped working at some point after it.

## Why it was never durable

`real-ming.service` carried:

```
ExecStartPre=/usr/bin/install -d -o 1000 -g 1000 -m 0700 /var/lib/real-ming ...
```

That runs on **every start** and forces owner `1000`, group `1000`, mode `0700`.
The shared-group grant added during milestone 5 was applied by hand to a
directory whose permissions the unit rewrites at each restart, so it survived
exactly until the next one — the 7 September redeploy at 16:48.

This is the same class of defect as the missing `docker run --env` flag found
during the milestone 3 cutover: a change proven live, but not written into the
artifact that reconstructs the host. Both were invisible to the test suite
because neither a harness nor a unit test can see a systemd directive.

## The fix

```
ExecStartPre=-/usr/sbin/groupadd -f real-ming-data
ExecStartPre=-/usr/sbin/usermod -aG real-ming-data real-ming
ExecStartPre=/usr/bin/install -d -o 1000 -g real-ming-data -m 2770 /var/lib/real-ming ...
```

`2770` rather than `0770` matters: the setgid bit makes SQLite's `-wal` and
`-shm` files inherit the shared group as the container creates them. Without it
the database file would be reachable while its journal was not, which fails in a
way that reads like corruption rather than permissions.

The first two lines are prefixed `-` so a host that already has the group is
unaffected and a failure there cannot block startup.

## Verification

| Check | Result |
| --- | --- |
| Directory after restart | `drwxrws--- azureuser real-ming-data` — the grant now survives |
| Service account read | Yes |
| New `-wal` / `-shm` group | `real-ming-data`, inherited via setgid |
| `hermes mcp test real-ming` | ✓ Connected (823 ms), ✓ 3 tools discovered |
| `real-ming.service` | active |

A deployment preflight check now asserts the unit contains
`-o 1000 -g real-ming-data -m 2770 /var/lib/real-ming`, so reverting it fails
`npm run check` rather than silently disabling the extension again.

`npm run check` 814 passed / 2 skipped exit 0; `npm audit --audit-level=high`
exit 0; `git diff --check` exit 0.

## What this does not fix

The underlying trade-off recorded in milestone 5 is unchanged: the shared group
also lets the agent reach the operations database directly with its `file` and
`terminal` tools, bypassing the lifecycle guards the MCP tools enforce. SQLite
WAL needs directory write access even for readers, so a read-only grant is not
available without a separate read projection. That projection is still not
built, and this fix does not make it less necessary.

## Consequence for milestone 5

The deployed `/opt/real-ming-extension` is the 6 September build and exposes
three tools. `real_ming_run_scheduled_report` is not present, so the native cron
cutover additionally requires deploying the current extension build before any
job is created.
