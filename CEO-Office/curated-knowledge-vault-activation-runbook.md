# Legacy Curated Knowledge Vault — one decision, then it can read Live

**Status: COMPLETED — 14 September 2026.** The CEO chose **Option A**: the
six-root curated vault is superseded as an activation target, and the
curated-knowledge guarantees row now reads `Live` because the guarantees are
delivered by the live role-scoped path. Recorded in
[ADR-0024](../docs/adr/0024-supersede-the-six-root-curated-vault-with-the-role-scoped-path.md).

Nothing in this runbook is waiting on anyone. It is retained as the record of
the decision and as the procedure if the vault is ever activated later.

## Outcome

**Option A was chosen.** No credential was provisioned, no second knowledge
system was activated, and no deployment was needed.

| What | Result |
| --- | --- |
| Capability row | `Curated-knowledge guarantees` now reads **Live**, stated as a guarantee rather than an implementation |
| Guarantees delivered by | The live role-scoped selective native knowledge path — see §1 |
| Six-root vault + Projection Broker | **Superseded as an activation target.** Code, tests and credential retained; never activated |
| Accepted as not required | Encryption at rest across six separate roots, and a distinct Projection Broker component |
| Decision record | [ADR-0024](../docs/adr/0024-supersede-the-six-root-curated-vault-with-the-role-scoped-path.md) |
| Reversible? | Yes. §3 Option B remains the procedure, and nothing was deleted |

The rest of this file is the reasoning behind that choice, kept so the decision
can be re-examined on its merits rather than re-litigated from memory.

## Correction

A previous version of this runbook told you to generate and store
`REAL_MING_VAULT_KEY`. That instruction was wrong twice over, and you were right
to challenge it:

1. **The secret already exists.** `real-ming-vault-key` is in the
   `real-ming-vault` Key Vault, confirmed by listing secret **names** through
   the host's managed identity.
2. **The name in that instruction could not have worked anyway.** Key Vault
   permits lowercase alphanumerics and hyphens only. `credential-resolver.ts`
   maps `REAL_MING_VAULT_KEY` → `real-ming-vault-key`, which is exactly what is
   stored. Azure would have rejected the underscored name.

The mistake came from checking the host's env files, which is the wrong place:
this system deliberately resolves secrets from Key Vault at runtime so no copy
rests on disk. **Nothing for you to provision. No action was needed and none was
taken.**

That the key resolves is not an assumption. `createProductionControlPlane`
throws unless **every** credential in the inventory resolves, and
`REAL_MING_VAULT_KEY` is in that inventory. `real-ming.service` is running, so
it resolved.

## Why this needs you

Not a credential — a decision, and one that reverses a standing position of
yours.

The status board records decision 2, *Optional curated-knowledge guarantees*, as
*"Defer. Prove native Obsidian/LLM-Wiki knowledge first in milestone 6, then
decide against observed gaps instead of in advance."* Milestone 6 is done and
the native path is live, so the deferral can now be settled on evidence.

[ADR-0020](../docs/adr/0020-run-ming-on-the-native-hermes-runtime.md) also says
this vault is activated **"only where a required guarantee is demonstrated."**
Turning it on without naming the guarantee you need would contradict that
decision, which is why this is your call rather than an engineering default.

---

## 1. Read this first: you probably do not need this vault

The capability row describes *guarantees*, not a product. Most are **already
live** via the role-scoped selective native knowledge path.

| Guarantee in the legacy row | Already live? |
| --- | --- |
| Versioned, atomic publication | **Yes.** Immutable generations, one active pointer; publication epoch 2 today |
| Candidate quarantine before publication | **Yes.** Candidates admitted, hashed, dispositioned; unsupported material excluded |
| Access-controlled cross-domain projection | **Yes.** Gated by Executive Role **and** Trust Domain — your own test saw `Personal CFO` refused for `Ming Creatives` |
| Trust-Domain scoping | **Yes.** [ADR-0023](../docs/adr/0023-scope-native-knowledge-retrieval-by-trust-domain.md) |
| Forgetting with an independent tombstone head | **Yes.** Restore-safe, proven on the host |
| Encryption at rest across six separate roots | **No.** Genuinely only in this vault |
| A distinct Projection Broker component | **No.** The live path gates retrieval directly instead |

Activating this buys **encryption-at-rest across six roots** and a **separate
broker component**. It costs a second knowledge system to operate and key, and a
second place where "what does the agent know" can diverge from the first.

## 2. The actual technical state

| Element | State |
| --- | --- |
| `real-ming-vault-key` in Key Vault | ✅ exists, resolves at startup |
| Credential inventory entry | ✅ present and satisfied |
| `control-plane-cli.ts` passes `knowledgeOperations` | ❌ **no — this is the whole gap** |
| `knowledgeVault`, knowledge compiler, Projection Broker, Obsidian materializer | ❌ all constructed as `undefined`, never run |
| The six Trust-Domain roots | ❌ absent; `/var/lib/real-ming/obsidian` holds 0 files |
| `REAL_MING_OBSIDIAN_ROOTS` | set to `CEO` — one root name, consumed by nothing today |

One missing argument in one entrypoint is why the whole subsystem is dark.

## 3. Your two options

| Option | What it means | Recommendation |
| --- | --- | --- |
| **A — Retire the row as superseded** | Rewrite the capability row to say the guarantees are met by the live role-scoped path, and record the vault as a superseded design in the ADR trail. No second system, no deployment, no new operational surface. Every row reads `Live` honestly. | **Recommended** |
| **B — Activate the vault** | Pass `knowledgeOperations` in the entrypoint, red-to-green through the Real-Ming System Harness, deploy a new image, create the six roots, compile one cited candidate, then prove each guarantee **against the vault itself**. | Only if you can name the guarantee you need that the live path does not already give you |

Option A reaches your goal today and needs no deployment. Option B is a normal
ticket — roughly a day, most of it proving the guarantees rather than writing
the wiring.

**Either way, say which.** Option B changes production behaviour and restarts
the control plane, so it will not start without your word.

## Expected results, if you choose B

| Check | Pass condition |
| --- | --- |
| Wiring | Control plane starts with a defined `knowledgeVault`; `knowledge_health` reports the vault, not only the native registry |
| Roots | The six Trust-Domain roots exist and are encrypted at rest |
| Publication | One cited candidate compiles into a versioned generation with an atomic active pointer |
| Quarantine | An unsupported or contradictory claim is quarantined, not published |
| Projection | A role reading another role's root is refused |
| Non-interference | The live role-scoped path is unaffected; the two share no state |
| Only then | The capability row may be changed to `Live` |

## Troubleshooting, if you choose B

| Symptom | Action |
| --- | --- |
| Control plane refuses to start after wiring | The vault key resolved before, so suspect the new options object, not the credential. Read the startup error; it names the unresolved variable |
| `knowledge_health` still reports only the native registry | `knowledgeOperations` is still not passed |
| The six roots stay empty | Nothing has compiled. An empty vault is not an activated vault, and the row stays `Partial` |
| You want to undo it | Stop passing `knowledgeOperations` and redeploy. The live role-scoped path shares no state with this vault and is unaffected |

## CEO sign-off record

- [x] §1 read and the guarantee comparison understood.
- [x] **Option A chosen** — retire the row as superseded (no deployment). *14 Sep 2026.*
- [ ] ~~Option B — name the required guarantee, then activate.~~ Not chosen; no required guarantee was identified that the live path does not already provide.
- [x] Decision recorded in ADR-0024.
- [x] Capability row changed to `Live`.

**This runbook is closed.** Reopen it only if a guarantee appears that the live
path cannot meet — encryption at rest across six separate roots being the
obvious candidate.
