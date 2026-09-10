# Workbook — wiring the role skills to durable knowledge

**Status:** working notes for a future enhancement. Nothing here is approved,
scheduled or implemented. Written 10 September 2026 against the deployed system.

This is a thinking document, not a plan. It records what exists, what was
designed and never built, and one opinionated route through the three knowledge
systems currently in play. Treat the recommendations as a starting position to
argue with.

## 1. What is actually deployed today

Measured on the host, not read from a diagram.

| Thing | Deployed | Note |
| --- | ---: | --- |
| Role skills | **5** | `coo`, `cto`, `cmo`, `personal-cfo`, `cao` |
| Vocabulary/authority skill | **1** | `real-ming` |
| MCP tools | **9** | 3 work-item · 1 report · 5 provider |
| Cron rows | **2** | 07:30 and 21:30 `Asia/Kuala_Lumpur` |
| Plugins | **0** | none exists |

**No role skill references a vault, a root, or retrieval.** Grep across
`hermes/skills/ming/*/SKILL.md` finds vault language in exactly one file —
`knowledge-consolidation`, which is not deployed.

## 2. What a role skill does, and does not do

A role skill is prose loaded into context when Hermes decides the work matches.
That is the whole mechanism: no code, no data, no lookup.

`cto/SKILL.md` is 52 lines. What it buys:

- "You do the engineering — read the repository, change it, run the tests, read
  the failure, fix it." Without it, the model more readily *describes* work.
- A definition of finished: the diff exists, the tests ran, and the real exit
  status can be stated. "It should work now" is not a result.
- "A red suite reported honestly is worth more than a green claim."
- Release path: branch → pull request → checks → preview. No deploy-latest.
- An Approval names an exact commit; push another and that Approval is dead.

What it does not buy: **any knowledge.** It cannot say what DuitSini does, what
was decided last month, or what is on the calendar. There is no retrieval behind
it.

So the honest framing is that role skills change **standards, not knowledge**.
Same model, same tools, same repository access — a different bar for what counts
as done. The 8 September DuitSini round trip is the evidence that this is worth
something: failing tests first, unprompted, and a self-caught typecheck
regression.

**The limit worth repeating:** guidance is not enforcement. A skill that says
"never push to production" does not prevent a push. Only the absence of a tool,
or a hook, does that.

## 3. The half that was designed and never built

The original design had each perspective reading its own root:

```
Personal/          COO — life, career, selected personal context
Ming-Creatives/    CTO technical and CMO content
Academic/          CAO — course, commitment, study
Finance/           Personal CFO — analytical only, never a ledger
Entertainment/     isolated digest, no executive
CEO/               reviewed cross-domain projections only
```

with an LLM-wiki folder shape (`SCHEMA.md`, `raw/`, `wiki/`, `daily/`,
`outputs/`, `quarantine/`, `index.md`, append-only `log.md`), Candidate Envelope
quarantine and a Projection Broker.

**None of it is on the host.** `REAL_MING_OBSIDIAN_ROOTS` is unset, none of the
six folders exist, and the only production use of `vaultRoots` is validating
configured names. Five playbooks shipped with the framing half and without the
knowledge half.

## 4. Three knowledge systems now exist. Do not run three.

| System | State | Owner |
| --- | --- | --- |
| **Native knowledge notes** | live | Hermes — its own Obsidian and LLM-Wiki skills |
| **Selective wiki consolidation** (ADR-0022) | controlled-tested, undeployed | Real-Ming registry, `.real-ming/generated` |
| **Curated vault** (ADR-0018) | built, no production caller | six roots, Projection Broker, encrypted generations |

ADR-0020 exists because maintaining two agent platforms costs more than it
returns. The same logic applies to knowledge stores, and a third one would be
the same mistake wearing a different hat.

### The opinion: the six roots are a taxonomy, not a storage system

This is the crux. What made the roots valuable was **CTO reads Ming-Creatives,
CAO reads Academic** — a scoping idea. That value does not require an encrypted
versioned store with a Projection Broker to deliver.

**Make the domain a field, not a filesystem.**

The ADR-0022 registry already carries candidate metadata. Give each candidate a
`domain` from the six-value set. Then:

- `wiki_retrieve(domain: "Ming-Creatives")` gives the CTO skill scoped retrieval.
- No six folders on disk, no second vault, no Projection Broker.
- The roots become a **query dimension over one generated store**, not a parallel
  storage tree.

That preserves what the roots were for and discards what made them expensive.
ADR-0018's stronger guarantees — encryption at rest, atomic versioned
publication, cross-domain projection — stay retired and optional, to be
activated only if a demonstrated requirement appears. Revision 6 already frames
them that way; this keeps that promise instead of quietly reversing it.

### Writers stay separate

Three writers, one vault directory, distinct ownership — already the ADR-0022
design, and adding a `domain` field does not disturb it:

| Writer | Path | Rule |
| --- | --- | --- |
| Ming, by hand | vault root | never rewritten by any agent |
| Hermes native notes | vault root | Hermes owns; the live path today |
| Generated wiki | `.real-ming/generated` | registry-governed, tombstoned, cited |

### The risk this introduces

If roles retrieve by domain, **a wrong domain tag silently hands the CAO the
CFO's material.** Domain assignment should therefore be explicit at capture —
Ming marks it — rather than inferred by the model, at least in the first slice.
That is consistent with ADR-0022's existing "deliberately marked" principle and
costs nothing to keep.

## 5. Sequencing opinion

1. **Do not wire roles to consolidation yet.** It is NOT READY — the 10
   September packet records NKC-10 blocked and no live acceptance. Wiring
   unproven guidance to an unproven pipeline compounds two uncertainties.
2. **Add `domain` to the candidate contract before deployment.** Retrofitting a
   field into a published generation format is far more painful than adding it
   now, and it is a small change while nothing is live.
3. **Then add one line per role skill** — "for technical work, `wiki_retrieve`
   with `domain=Ming-Creatives` before answering, and cite it."
4. **Keep enforcement on a separate track.** Do not couple it to this.

## 6. Where a plugin would genuinely earn its place

Not for the roles. A role is guidance, and guidance is categorically a skill —
making it a tool means either a call that returns text (a skill with latency) or
a call that secretly runs another agent, which is the endpoint shape this project
has already rejected.

**For enforcement.** The gap is that `cto` says "never push directly to
production" and nothing stops a push. A hook that blocks it is a genuine runtime
extension, and that is what plugins are for. This is the same gap the README
already names as `Event-driven mandatory controls — Planned`; it appears twice
because it is one hole.

**Caveat before building one:** a hook is only as good as its coverage. A hook
guarding a git tool does not stop a shell tool running `git push`. Enforcement by
absent capability — no send tool, no `gmail.send` scope — remains stronger than
enforcement by interception, and should be preferred wherever the choice exists.

## 7. The change worth making regardless

**Separate role from procedure.**

Today there are five role skills and no workflow skills. "COO" is a perspective;
"tailor a CV" is a procedure. They should be different skills that compose — COO
playbook + CV-tailoring skill + verified candidate data + output template.

Left alone, each role file grows into a monolith that triggers on everything and
guides nothing sharply. This is worth doing before the files get fat, and it is
independent of the vault work.

## Open questions

- Is `domain` a single value per candidate, or can one artifact belong to two?
  `Ming-Creatives` already spans CTO and CMO views.
- Does `CEO/` remain meaningful as a domain when it was defined as *reviewed
  cross-domain projections* — an output of review rather than a capture target?
- Should `Entertainment` exist at all in the first slice, given it has no
  executive and was digest-only by design?
- Does a role skill retrieving on every turn cost more than it returns for
  ordinary conversation, and should retrieval be explicitly requested instead?

## Related

- [ADR-0020](../adr/0020-run-ming-on-the-native-hermes-runtime.md) — Hermes is the runtime
- [ADR-0018](../adr/0018-compile-knowledge-into-trust-domain-vaults.md) — the curated vault and six roots
- [ADR-0022](../adr/0022-native-knowledge-consolidation-around-hermes.md) — selective consolidation
- [Design spec](../superpowers/specs/2026-09-08-native-knowledge-consolidation-design.md)
- [Final remediation packet](../evidence/RM-40-native-knowledge-final-remediation-review-packet-2026-09-10.md) — the NOT READY record
