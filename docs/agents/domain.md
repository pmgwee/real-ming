# Domain Docs

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant system-wide decisions under `docs/adr/`.

If either is absent, proceed silently.

## File structure

Real-Ming is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── agents/
└── src/
```

## Use the glossary's vocabulary

Use terms exactly as defined in `CONTEXT.md` in issue titles, specifications, tests, implementation plans, and code.

Do not substitute synonyms that the glossary explicitly marks with `_Avoid_`.

If a necessary concept is missing, record the gap for domain modelling rather than silently inventing competing terminology.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, identify that conflict explicitly rather than silently overriding the decision.
