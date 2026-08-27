# CEO actions required

Phase 3 agent work has reached the human gate. Seven tickets are closed with acceptance evidence, and **every one of the 37 remaining tickets is blocked solely by the two actions on this page**. No further ticket can be started by an agent until at least one of them is done.

Run `npm run graph:status` at any time to recompute this from live GitHub state.

| Gate | Issue | Unblocks | Who |
| --- | --- | --- | --- |
| Provision Tracer 1 identities and secrets | [#7](https://github.com/pmgwee/real-ming/issues/7) | 36 tickets | CEO only |
| Capture the first DuitSini pilot Work Item | [#25](https://github.com/pmgwee/real-ming/issues/25) | 5 tickets | CEO only |

RM-06 is the critical path. RM-24 gates only the DuitSini promotion chain (RM-27, RM-28, RM-34, RM-40) and can be done in parallel or later.

---

## Gate 1 — RM-06: provision identities and secrets

Nothing here can be done for you: each step creates a real external identity or handles secret material, which agents must never do.

### 1. Create the external identities

- [ ] **Private Telegram bot** via BotFather. Keep the bot private; do not add it to groups.
- [ ] **Your numeric Telegram user id** — the single identity allowed to command Real-Ming. A username is not sufficient; the allowlist is numeric.
- [ ] **Notion internal integration**, shared only with the Master Tasks data source.
- [ ] **Google OAuth client** for Calendar, authorized for the calendar account you actually use behind Notion Calendar.
- [ ] **Always-on control-plane environment** with a secret store that supports rotation.
- [ ] **Dashboard access token** and **Knowledge Vault key**, generated with a CSPRNG.
- [ ] **Private-worker shared secret** for the Lenovo.

### 2. Store the values

Copy `.env.example` to `.env` and fill it from your secret store, or set the same names directly in the control-plane environment. `.env` and `.env.*` are already ignored by Git; `.env.example` holds names only and is the sole committed copy.

The complete inventory — variable, owner, purpose, environment, and revocation procedure — is generated from `src/config/tracer-secrets.ts` and reproduced in [CREDENTIAL-INVENTORY.md](CREDENTIAL-INVENTORY.md). It records **no values**, which is what issue #7 requires.

### 3. Verify without exposing anything

```bash
npm run secrets:preflight
```

This reports only which names are present and which are missing. It never prints, logs, or transmits a value.

### 4. Rules that must hold

- No credential, recovery code, or private identifier in Git, issue text, test fixtures, logs, or any model prompt.
- Every credential rotatable and revocable without a code change — the application reads names, never literals.
- `npm run check` includes a guard that scans every tracked file for credential-shaped material and fails the build if any appears.

### 5. Close the gate

Comment on [#7](https://github.com/pmgwee/real-ming/issues/7) confirming each identity exists, the inventory is complete, and no secret value was recorded anywhere, then close it. Do not paste any value into the comment.

---

## Gate 2 — RM-24: capture the first DuitSini pilot Work Item

This gate is a product decision, not a configuration step. Only you can choose what the pilot builds.

- [ ] **Choose one concrete DuitSini update** and state the intended user outcome in plain language.
- [ ] **Write acceptance evidence** that separates required behaviour from implementation preference. "The renewal date shows in the user's timezone" is required behaviour; "use a date picker component" is preference.
- [ ] **Classify the effects involved**: code only, or also database migration, production-data change, permission change, or external communication. Each is a separate Approval scope and cannot be bundled.
- [ ] **State the preview data rule**: mock, synthetic, staging, or redacted. Production finance-adjacent metadata must not reach logs or evidence.
- [ ] **Resolve every open product question** before labelling the Work Item ready. An unresolved decision at this stage becomes an unreviewable Outcome Report later.

Close [#25](https://github.com/pmgwee/real-ming/issues/25) with the captured Work Item once all five hold.

---

## After either gate closes

Nothing needs restarting. Recompute and continue:

```bash
npm run graph:status
```

The scheduler reconciles against live GitHub state, so closing an issue is enough to release its dependents. Closing RM-06 alone makes RM-07, RM-09, and RM-12 immediately available.
