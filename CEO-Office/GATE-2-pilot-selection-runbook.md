# Gate 2 — RM-24 DuitSini Pilot Selection Runbook

> **TL;DR — pick one small, real DuitSini update and write it up in the five sections below.** This is a product decision, not a setup task. It unblocks 5 tickets and is **not** on the critical path — safe to leave until after RM-16. Budget ~20 minutes of thinking, no commands to run.

---

# 🎯 Why this is a ticket at all

A fair question: *"isn't picking a DuitSini update something I do after the agent is finished?"*

Not quite. This is the **second tracer bullet**. Its job is to prove the MicroSaaS Operations Loop actually holds on a real target:

```
CEO request → CTO task branch → tests → draft PR → Vercel preview
    → exact-commit Approval → merge → live verification → Outcome Report
```

Every guardrail in that chain — no direct production push, no deploy-latest, Approval bound to one exact commit, migrations approved separately, merge ≠ success — is only *proven* if a real update travels the whole way under review. A fake update would prove nothing.

So it is not "start using your agent for real work." It is **one supervised proof run**. Ordinary daily use comes after RM-40.

**Pick something small.** The goal is to exercise the pipeline, not to ship something ambitious. A one-screen copy fix or a date-formatting correction is an ideal tracer.

---

# 📝 What to write

Copy this into a comment on [#25](https://github.com/pmgwee/real-ming/issues/25), fill it in, then close the issue.

## 1. The update and the intended user outcome

One concrete change, in plain language, from the user's point of view.

> *Example shape:* "Renewal dates on the subscription list show in the user's local timezone, so a renewal never appears to be a day early or late."

- [ ] One update, not a bundle
- [ ] Stated as a user outcome, not an implementation

## 2. Acceptance evidence

Separate **required behaviour** from **implementation preference**. This is the line that decides whether an Outcome Report is reviewable later.

| Required behaviour (must hold) | Implementation preference (nice, not binding) |
| --- | --- |
| e.g. renewal date matches the user's device timezone | e.g. use `date-fns` rather than `Intl` |

- [ ] Every required item is observable — something you could check yourself in the preview
- [ ] Nothing in the required column is a code-style opinion

## 3. Effect classes involved

Tick every class this update touches. **RM-04 now enforces these as separate Approval scopes that cannot be bundled**, so this list directly determines how many Approvals you will be asked for.

- [ ] Code change only
- [ ] Database migration
- [ ] Production-data change
- [ ] Permission change
- [ ] External communication
- [ ] Purchase

> 💡 For a first tracer, **code change only** is strongly preferable. A migration doubles the Approval work and adds rollback planning.

## 4. Preview data rule

State which the preview may use:

- [ ] Mock · [ ] Synthetic · [ ] Staging · [ ] Redacted

And confirm: **no production finance-adjacent metadata may reach logs, preview output, or Project Evidence.** DuitSini holds real billing records; the preview must not echo them.

## 5. Open product decisions

List every unresolved question, then answer each one **before** closing this issue.

- [ ] There are zero unanswered questions remaining

> ⚠️ An unresolved decision here becomes an unreviewable Outcome Report at RM-27. The whole point of the guarded loop is that you review an outcome, not a debate.

---

# 🏁 Closing the gate

Close [#25](https://github.com/pmgwee/real-ming/issues/25) once all five sections are filled and section 5 is empty.

Then restart the loop with [RESUME-PROMPT.md](../docs/agents/RESUME-PROMPT.md) — though if RM-06 is still open, nothing will start yet.

---

# 🧯 Common traps

| Trap | Why it hurts |
| --- | --- |
| Picking something big | The tracer exists to prove the pipeline. A large change makes a failed run ambiguous — was it the pipeline or the feature? |
| Bundling two changes | Two changes may span two Approval scopes and cannot be approved together. RM-04 will refuse. |
| Writing preferences as requirements | The CTO will treat them as binding, and the Outcome Report becomes an argument about style. |
| Leaving a question open | RM-27 stops and asks, costing a full round trip. |
| Choosing something needing production data to verify | The preview cannot use it, so verification becomes impossible without violating the data rule. |

---

# 📌 Scope note

RM-24 blocks only **RM-27, RM-28, RM-34, and RM-40** — five tickets, all late. It is not on the critical path. If you want the fastest progress, close **Gate 1 first** and leave this one until Tracer 1 is proven at RM-16.
