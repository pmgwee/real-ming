# RM-40 · Milestone 6 — native memory and the Obsidian vault, live

Executed 7 September 2026, 03:18–03:24 UTC (11:18–11:24 KL) on
`real-ming-control-plane-my`. No provider write, no Telegram delivery, no
schedule change.

## TL;DR

The native vault works end to end: a cited note was written, retrieved from two
**separate** sessions, retrieved again after a Hermes restart, captured by the
protected backup, and restored byte-identical to an isolated directory.

Memory write approval stays **off**, which is the CEO's recorded decision. One
defect was found on the way: the configuration fragment in the repository said
the opposite.

## The fragment contradicted the decision

`hermes/config.native-first.example.yaml` carried `write_approval: true`, and
the fragment exists precisely so someone can apply it with `hermes config set`.
Applying it would have silently reversed the decision Ming made hours earlier —
the exact "a later pass quietly undoes a choice" failure this project keeps
finding.

The fragment now reads `write_approval: false` with the reasoning beside it, and
the skill-pack test asserts `false` rather than `true`, so the drift cannot
return through a green build.

The two limits from the fragment were applied; `write_approval` was not touched.
Live values: `memory_enabled=true`, `user_profile_enabled=true`,
`write_approval=false`, `memory_char_limit=2200`, `user_char_limit=1375`.
`hermes config check` reports config version 40 ✓.

## Note, citation and retrieval

Both bundled skills are present and enabled: `obsidian` (note-taking) and
`llm-wiki` (research), each `builtin`.

A note was created through the agent, not by hand:

```
/var/lib/hermes-real-ming/obsidian-vault/Native cron ownership.md

# Native cron ownership
From 7 September 2026, the 07:30 morning brief and 21:30 executive roll-up are
triggered and delivered by native Hermes cron, while Real-Ming still composes
them.
The held-notice sweep stays on Real-Ming's scheduler.
Source: `docs/evidence/RM-40-v6-milestone-5-cron-cutover-2026-09-07.md`
```

The citation points at a file that genuinely exists, and the content matches the
decision recorded in it.

| Retrieval check | Session | Result |
| --- | --- | --- |
| Asked what triggers the 21:30 roll-up | `20260907_031951_a603e2` | Correct — **but sourced from live `hermes cron list`, not the vault.** Better sourcing than a note, yet it does not prove vault retrieval, so it was not counted |
| Asked to search the vault and quote the Source line | `20260907_032028_fe3b38` | Returned the note title, the held-notice sentence and the Source line verbatim |
| Same question after `systemctl restart hermes` | fresh session | Returned the composition split and the Source line again; `telegram` reconnected |

The middle row is the one that proves the vault path. The first is recorded
because it is a real observation about how the agent prefers live truth over a
stored note — useful behaviour, but not the thing under test.

## Backup and isolated restore

The protected backup ran once. The manifest now carries **13 files**, including
the vault:

```
hermes-native-vault | hermes-vault/Native cron ownership.md | 638ad4eccd517d8f
```

alongside `state.sqlite`, the Notion write ledger, the retained bridge session
map, seven native Hermes databases, `sessions/sessions.json` and
`memories/USER.md`.

Isolated restore of that generation:

```
Control-plane restore verified 13 files; 10 SQLite stores passed integrity checks.
```

The restored note was **byte-identical** to the live file, and the isolated copy
was removed afterwards. The restore CLI refuses a destination that already
exists, which is the right default and was confirmed by hitting it.

## What still needs Ming

Opening the vault from an authorized Obsidian client on his own device. The
Azure-local path is now proven, which was the precondition. Everything else in
the milestone's live-acceptance list is done.

## Boundaries held

- No secret entered the vault, a prompt, a note or this document.
- The native vault at `/var/lib/hermes-real-ming/obsidian-vault` stays separate
  from the generated Real-Ming CEO projection at `/var/lib/real-ming/obsidian`,
  so one writer owns each path and a generated export cannot overwrite a
  hand-edited note.
- `OBSIDIAN_VAULT_PATH` is supplied by `hermes.service` as an `Environment=`
  directive, not from the profile `.env`. A bare SSH shell therefore does not
  have it — the same class of difference as `API_SERVER_KEY` during the cron
  cutover. Tests here supplied it explicitly to reproduce the gateway's
  environment faithfully.
