# Verify the three knowledge capabilities — and see what your second brain holds

**Status:** ready to run. Read §1 first; it is the part most likely to surprise
you.

## TL;DR

Three capability rows read `Live` and people reasonably assume they mean
"the agent has a populated second brain". **They do not.** They mean the
machinery is proven end to end. Your generated corpus today is **two test
fixtures totalling 217 bytes**.

This runbook shows you exactly what is stored, how to open it in Obsidian, how
to test each of the seven knowledge tools from Telegram, and the one thing that
has to happen before any of it is useful for real work.

**Do not build the six `Personal/ Ming-Creatives/ Academic/ Finance/
Entertainment/ CEO/` roots.** See §5.

---

## 1. What is actually in there right now

Measured on the host, 14 September 2026.

### The Obsidian vault — `/var/lib/hermes-real-ming/obsidian-vault`

| Path | Size | Writer |
| --- | ---: | --- |
| `Native cron ownership.md` | 316 B | Agent-written note, **yours to edit** |
| `.real-ming/generated/…/pages/rm54-live-acceptance-live.md` | 150 B | Governed, agent-owned |
| `.real-ming/generated/…/pages/rm54-live-acceptance-alpha.md` | 67 B | Governed, agent-owned (forgotten) |
| `.real-ming/generated/…/{manifest.json, index.md, log.md}` | — | Generation bookkeeping, two generations |

**That is the entire corpus.** One real note, and two RM-54 acceptance fixtures.

### Hermes native memory — `/var/lib/hermes-real-ming/memories`

| File | State |
| --- | --- |
| `USER.md` | 1,354 B — exists and has content |
| `MEMORY.md` | **does not exist** (only a zero-byte lock file) |

Native memory is Hermes's own and Real-Ming never writes it. That `MEMORY.md` is
absent is Hermes's business, not a Real-Ming fault.

### The designed LLM-wiki shape

`SCHEMA.md`, `AGENTS.md`, `CLAUDE.md`, `raw/`, `wiki/`, `daily/`, `outputs/`,
`quarantine/`, `index.md`, `log.md` — **none of these exist.** They describe the
superseded curated vault, not the live path. See §5.

## 2. See it yourself, in your own Obsidian

One-way pull to your laptop. Full steps are in the
[access runbook](dashboard-and-obsidian-access-runbook.md); this is the command:

```bash
ssh -i ~/.ssh/real_ming_southeastasia_ed25519 azureuser@100.110.253.35 'sudo tar cz -C /var/lib/hermes-real-ming/obsidian-vault .' | tar xz -C ~/Obsidian/real-ming
```

Then open `~/Obsidian/real-ming` as an Obsidian vault. You will see
`Native cron ownership.md` at the top level, and `.real-ming/generated/` holding
the governed pages. Obsidian hides dot-folders by default — enable **Settings →
Files & Links → Detect all file extensions**, or just browse the folder in your
file manager.

> **This is a read-only snapshot.** Edits you make locally never travel back,
> and the next pull overwrites them. Azure remains canonical.

---

## 3. Test each capability from Telegram

### 3a. Native knowledge notes — Hermes's own Obsidian + LLM-Wiki

This is Hermes writing ordinary notes. It is *not* the governed path.

```
Write a short note in my Obsidian vault titled "CEO test note" recording that I verified the vault on 14 September 2026, then tell me the file path.
```

**Pass:** the agent reports a path under the vault. Re-run the §2 pull and the
new `.md` file appears.

```
What notes are in my Obsidian vault right now?
```

**Pass:** it lists `Native cron ownership.md` and your new note. Delete the test
note afterwards if you want.

### 3b. Role-scoped selective native knowledge — the governed path

```
Report native knowledge health: active generation, repair state, backlog, stale and quarantined counts.
```

**Pass:** `repair state: healthy`, backlog `0`, active generation
`native-knowledge-generation-cb09e3ed-…`.

```
Search the wiki for the exact phrase "role-scoped native knowledge" and quote the citation.
```

**Pass:** returns the page citing `issue:54/live-acceptance-live`, Trust Domain
`Ming Creatives`.

> Retrieval is a **contiguous substring match**, not search. A natural-language
> question usually returns nothing. That is the reader being honest, not broken.

### 3c. Curated-knowledge guarantees — now stated as guarantees

Each is a property you can provoke rather than a folder you can inspect.

| Guarantee | Ask this | Pass |
| --- | --- | --- |
| Access-controlled projection | `As Personal CFO, retrieve the Ming Creatives wiki knowledge.` | **Refused** as unauthorized |
| Versioned atomic publication | `Which generation is active, and what happened to the previous one?` | Names the active generation and the previous as `superseded` |
| Restore-safe forgetting | `What exactly does forgetting remove, and what is NOT erased?` | Distinguishes supported-path suppression from native memory, session history and source systems |
| Quarantine / honest failure | `Has any knowledge candidate ever failed to publish, and why?` | Mentions the fixture rejected for a content hash missing its `sha256:` prefix |

---

## 4. The seven tools — what each is for

| Tool | What it does | Realistic use | Drive from chat? |
| --- | --- | --- | --- |
| `knowledge_health` | Run, generation, tombstone, backlog and repair state | "Is the knowledge system healthy?" | **Yes** |
| `wiki_retrieve` | Returns cited pages for one authorized Role + Trust Domain | "What do we know about X?" — exact phrase | **Yes** |
| `knowledge_list_candidates` | Opaque candidate metadata; never prose | "What is queued for publication?" | **Yes** |
| `forget_wiki_knowledge` | Suppresses a subject, writes a durable tombstone | "Forget what we recorded about X" | **Yes** — needs only subject, reason, timestamp |
| `read_knowledge_source` | Reads one **declared** source and returns identity, version, hash, content | Evidence-checking before publication | **Only for a source already declared** in the source route |
| `capture_knowledge_candidate` | Admits one source-backed claim as a candidate | "Save this decision as durable knowledge" | **Partly.** Needs a source identity, reference, version, excerpt and a `sha256:`-prefixed content hash. Hermes can compute these, but it is a job-shaped operation, not a casual chat one |
| `stage_knowledge_generation` | Publishes a complete immutable snapshot | The consolidation job's final step | **No.** Needs a full manifest with hashes |

### Why "remember that I prefer X" will not work

The `knowledge-capture` skill requires *a source-backed claim*: stable source
identity, reference, version, bounded excerpt, content hash and `asOf`. A remark
in conversation has none of those. This is deliberate — a hash proves which bytes
were read, not that a claim is true, and the system refuses to launder opinion
into cited knowledge.

For "remember I prefer X", the right home is **Hermes native memory**, which is
Hermes's own feature and outside this path entirely.

### The gap that matters for real use

`read_knowledge_source` reads from a declared file route —
`/var/lib/hermes-real-ming/knowledge-live/sources.json`. It holds **two RM-54
test fixtures and nothing else**, and there is no automatic ingestion from
GitHub, Notion or mail today.

**So the system is live but has nothing real to work on.** Making it useful means
declaring real sources in that route. That is a build, not a setting, and it is
the single highest-value next step if you want this to become an actual second
brain.

---

## 5. Do not build the six roots

The diagram panel reading *"DESIGNED SHAPE, NOT HOST FOLDERS: the six roots and
the wiki layout below describe the optional curated vault. They are not
directories that exist on the Hermes host today"* is **correct and deliberate**.

Those six roots and the `SCHEMA.md / raw/ / wiki/ / daily/ / quarantine/` shape
belong to the curated vault that
[ADR-0024](../docs/adr/0024-supersede-the-six-root-curated-vault-with-the-role-scoped-path.md)
**superseded**. Creating them would activate the design you just decided not to
run, and would give you two knowledge systems that can disagree.

Trust Domains still exist and still enforce access — `Ming Creatives`,
`Personal`, `Academic`, `Finance`, `Entertainment` are live as **labels on
pages**, checked on every retrieval. They simply are not **folders**. The
guarantee survived; the filesystem layout did not, and did not need to.

Likewise **Projection Broker → Hermes** and **the local mirror** are superseded
or unbuilt by decision, not by omission. The live path gates retrieval directly;
no broker sits in front of it, and no mirror exists.

## Expected results at a glance

| Test | Pass |
| --- | --- |
| 3a note write | New `.md` appears after a re-pull |
| 3a note list | Lists the existing note plus yours |
| 3b health | `healthy`, backlog 0, active generation named |
| 3b retrieve | Cited page for the exact phrase |
| 3c role gate | `Personal CFO` **refused** |
| 3c versioning | Active named, previous `superseded` |
| 3c forgetting | Names what is *not* erased |
| 3c quarantine | Mentions the `sha256:` prefix rejection |

## Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| Wiki search returns nothing | Your phrase is not a contiguous substring of any page | Retry with an exact phrase, or `rm54-live-acceptance-live` |
| "No published supported page matched" for everything | Expected — the corpus is two fixtures | Declare real sources; see §4 |
| Agent offers to "remember" something conversational | It is using native memory, not the wiki | Fine, but do not record it as cited knowledge |
| `.real-ming` invisible in Obsidian | Obsidian hides dot-folders | Enable "Detect all file extensions", or browse in your file manager |
| Local edits vanish after a pull | The pull is one-way by design | Azure is canonical; edit through the agent |
| Role gate returns content instead of refusing | **Real defect** | Stop and report it; the gate is the guarantee |

## CEO sign-off record

- [ ] §1 read — I know the corpus is two fixtures plus one note.
- [ ] Vault pulled and opened in Obsidian.
- [ ] 3a — native note written and listed.
- [ ] 3b — health and cited retrieval confirmed.
- [ ] 3c — all four guarantees provoked.
- [ ] Decided whether to declare real sources (§4).
- [ ] Confirmed the six roots stay unbuilt (§5).
