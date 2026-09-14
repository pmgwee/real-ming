# Legacy Curated Knowledge Vault — can it be marked Live?

**Status:** **blocked on you.** It cannot be activated, and therefore cannot be
marked `Live`, until you provision one credential. Nothing else in the system is
waiting on this.

## TL;DR

You asked for every capability row to read `Live`. Every row can, **except this
one**, and the reason is not effort — it is a secret only you can create.

`REAL_MING_VAULT_KEY` derives the Knowledge Vault encryption key. The credential
inventory assigns it to **CEO** and says *"Provision during Gate 1"*. That never
happened: the variable is absent from every env file on the host and is not
passed into the container. No agent may create, hold, or type a credential
value, so this stops here.

**Before you provision anything, read §1.** There is a real question about
whether this vault should be activated at all, and the honest recommendation is
that it should not be.

## Why this needs you

- The value is a **secret**. Code reads variable *names*; values live only in
  Azure Key Vault or a gitignored `.env`. Nothing may put a credential into Git,
  an issue, a log, a test fixture, or a prompt — so no agent can generate or
  install this for you.
- Activating it **reverses a standing decision of yours.** The status board
  records decision 2, *Optional curated-knowledge guarantees*, as: *"Defer.
  Prove native Obsidian/LLM-Wiki knowledge first in milestone 6, then decide
  against observed gaps instead of in advance."* Milestone 6 is done and the
  native path is live. This runbook is where you make that decision knowingly.

---

## 1. Read this before provisioning: you probably do not need this vault

The capability row describes *guarantees*, not a product. Most of those
guarantees are **already live** — delivered by the role-scoped selective native
knowledge path, on a different implementation.

| Guarantee in the legacy row | Already live via the role-scoped path? |
| --- | --- |
| Versioned, atomic publication | **Yes.** Immutable generations with a single active pointer; publication epoch 2 today |
| Candidate quarantine before publication | **Yes.** Candidates are admitted, hashed and dispositioned; unsupported material is excluded |
| Access-controlled cross-domain projection | **Yes.** Retrieval is gated by Executive Role **and** Trust Domain — a `Personal CFO` request for `Ming Creatives` is refused |
| Trust-Domain scoping | **Yes.** See [ADR-0023](../docs/adr/0023-scope-native-knowledge-retrieval-by-trust-domain.md) |
| Forgetting with an independent tombstone head | **Yes.** Restore-safe, proven on the host |
| Encryption at rest across six separate roots | **No.** This is genuinely only in the legacy vault |
| A distinct Projection Broker component | **No.** The live path gates retrieval directly instead |

So activating the legacy vault buys you **encryption-at-rest in six roots** and a
**separate broker component**. It costs you a second knowledge system to operate,
key management, and two places where "what does the agent know" can diverge.

### The two honest options

| Option | What it means | Recommendation |
| --- | --- | --- |
| **A — Retire the row as superseded** | Rewrite the capability row to say the guarantees are met by the live role-scoped path, and record the legacy vault as a superseded design in the ADR trail. No new system, no new credential, no new operational surface. | **Recommended.** It makes the README read `Live` honestly, because the guarantees genuinely are |
| **B — Activate the legacy vault** | Provision the key, wire the production entrypoint, create the roots, compile, and prove the guarantees against it. Then the row reads `Live` on its own terms | Only if you specifically want encryption-at-rest across six separate roots |

Option A reaches "everything reads Live" without running a second system. If you
want A, say so and it becomes a documentation ticket — no credential needed.

The rest of this runbook is Option B.

---

## Prerequisites for Option B

- [ ] You have read §1 and still want the separate encrypted vault.
- [ ] You can reach the Azure Key Vault `real-ming-vault` with an account that
      may add a secret.
- [ ] You accept that this adds a second knowledge system alongside the live
      role-scoped path.
- [ ] You understand the code work in §3 has **not been written yet** and is a
      separate ticket, not a configuration change.

> Do not paste the key value into Telegram, an issue, a chat message, this file,
> or any prompt. If it ever appears in one of those, treat it as compromised and
> re-key.

## 2. Provision the credential (your hands only)

1. Generate a high-entropy random value locally. On your laptop:

   ```bash
   openssl rand -base64 48
   ```

   Do not reuse an existing key, and do not derive it from anything memorable.

2. Store it in Azure Key Vault as the secret name `REAL_MING_VAULT_KEY`, in the
   `real-ming-vault` vault. Use the Azure Portal or the CLI from a machine you
   control.

3. Confirm it exists **by name only**:

   ```bash
   az keyvault secret list --vault-name real-ming-vault --query "[].name" -o tsv
   ```

   `REAL_MING_VAULT_KEY` should appear in the list. Never print the value.

4. Clear your shell history if the value passed through it.

**Expected result:** the secret name is listed. Nothing else changes yet — the
control plane does not read it until §3 is built.

## 3. Engineering work that follows (a separate ticket, not yours)

Once the credential exists, the remaining work is ordinary engineering and needs
no further decision from you:

1. Pass `knowledgeOperations` from the production entrypoint. Today no entrypoint
   does, so `knowledgeVault`, the knowledge compiler, the Projection Broker and
   the Obsidian materializer are all constructed as `undefined` and never run.
2. Add `REAL_MING_VAULT_KEY` to the `real-ming.service` unit so the container
   receives it, resolved from Key Vault at runtime rather than resting on disk.
3. Create the six Trust-Domain roots under the configured Obsidian directory,
   which currently holds zero files.
4. Compile at least one cited candidate into a versioned root generation.
5. Red-to-green coverage through the Real-Ming System Harness only.
6. Prove each guarantee the row claims, against the vault itself — not against
   the role-scoped path.

## Expected results

| Check | Pass condition |
| --- | --- |
| Credential | `REAL_MING_VAULT_KEY` appears in the Key Vault secret **name** list; its value appears nowhere else |
| Wiring | The control plane starts with a defined `knowledgeVault`, and `knowledge_health` reports the vault rather than only the native registry |
| Roots | The six Trust-Domain roots exist and are encrypted at rest |
| Publication | One cited candidate compiles into a versioned generation with an atomic active pointer |
| Quarantine | An unsupported or contradictory claim is quarantined, not published |
| Projection | A role reading another role's root is refused |
| Only then | The capability row may be changed to `Live` |

## Troubleshooting

| Symptom | Action |
| --- | --- |
| The control plane refuses to start after §3 step 2 | The key is missing or unreadable from Key Vault. Confirm the name and the managed-identity grant; do not paste the value into the unit file |
| `knowledge_health` still reports only the native registry | `knowledgeOperations` is still not passed; §3 step 1 is incomplete |
| The six roots stay empty | Nothing has compiled yet. An empty vault is not an activated vault, and the row stays `Partial` |
| You want to undo this | Remove the key from the unit, stop passing `knowledgeOperations`, and the live role-scoped path is unaffected — it shares no state with this vault |

## CEO sign-off record

- [ ] §1 read, and Option A vs Option B chosen deliberately.
- [ ] **Option A chosen** — retire the row as superseded (no credential needed).
- [ ] **Option B chosen** — `REAL_MING_VAULT_KEY` provisioned in Key Vault.
- [ ] Engineering ticket raised for §3.
- [ ] Guarantees proven against the vault itself.
- [ ] Capability row changed to `Live`.
