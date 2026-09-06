# Ming's Hermes configuration pack

Version-controlled, **secret-free** configuration for the native Hermes runtime
on the Malaysia control plane. Architecture Revision 6 makes Hermes the product
runtime, so Ming's personalization belongs here — in native conventions — rather
than in a wrapper that re-implements the agent.

## What is here

| Path | Purpose |
| --- | --- |
| `SOUL.md` | A short Ming-specific layer over the shipped identity file. Ambient, so it stays small |
| `skills/ming/real-ming/` | The vocabulary and hard boundaries. Loaded when the work touches Ming's operations |
| `skills/ming/{coo,cto,personal-cfo,cao,cmo}/` | One playbook per Executive Role |
| `config.native-first.example.yaml` | Secret-free native memory policy and the Obsidian vault-path contract |

## Two rules that shape every file here

**Ordinary conversation must stay ordinary.** None of these skills may force a
role selection, a planning template, a JSON envelope or a Work Item. A question
gets an answer. That is the requirement Revision 5 lost and Revision 6 exists to
restore, so a skill that reintroduces ceremony is a regression, not a feature.

**A playbook is behaviour, not access control.** Nothing here can stop a tool
from running. Restrictions that must hold are enforced by narrowed credentials
and tested tool boundaries on the real execution path; where they cannot be, the
capability is left unavailable. Read a boundary below as "how Ming wants this
handled," never as "the system will prevent it."

## No secrets, ever

No token, key, chat id, database id, account number or document id belongs in
this directory. Configuration values live in the protected Hermes `.env` and in
Azure Key Vault. Files here name variables; they never carry values. The
repository's secret scan runs over every tracked file, this one included.

## Deploying

`./deploy-skills.sh` copies the pack to `$HERMES_HOME` on the control plane.
It never touches `.env`, `auth.json` or any credential material.

The example configuration is deliberately not copied over Hermes' live
`config.yaml`. Review it, then apply the non-secret keys with Hermes' native
configuration command:

```bash
hermes config set memory.memory_enabled true
hermes config set memory.user_profile_enabled true
hermes config set memory.memory_char_limit 2200
hermes config set memory.user_char_limit 1375
hermes config set memory.write_approval true
hermes config check
```

The systemd unit sets `OBSIDIAN_VAULT_PATH` to the native editable vault. The
older Real-Ming materializer writes a separate generated CEO projection, so
neither process overwrites the other's notes. Native memory is intentionally
small; source-backed, cross-domain knowledge still follows the LLM-Wiki and
Projection-Broker rules.
