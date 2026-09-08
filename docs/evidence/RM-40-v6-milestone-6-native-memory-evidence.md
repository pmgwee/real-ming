# RM-40 V6 · Milestone 6 — native memory and Obsidian foundation

Executed 6 September 2026 in the repository. This is controlled engineering
evidence; it is not evidence that the Malaysia Hermes service has been
reconfigured or that a real note has been written.

## What changed

- Added the secret-free native Hermes configuration fragment
  `hermes/config.native-first.example.yaml`. It keeps Hermes' built-in
  `MEMORY.md`/`USER.md` stores enabled, bounds their size, and stages memory
  writes for CEO review. Large source-backed knowledge remains in the
  Obsidian/LLM-Wiki workflow.
- Added the absolute native vault contract
  `/var/lib/hermes-real-ming/obsidian-vault` to the Hermes systemd unit and
  host preparation path. It is separate from Real-Ming's generated
  `/var/lib/real-ming/obsidian` CEO projection, so there is one writer per
  output path.
- Extended the recovery set to copy native vault files individually with
  per-file hashes and a directory digest. The native vault is uploaded before
  the completeness manifest; Hermes OAuth/auth files are never included.
- Extended the recovery boundary again to include the explicitly whitelisted
  native Hermes durable stores (`state.db`, Kanban, cron executions, response
  store, verification evidence, idempotency and project stores) plus the
  session/profile documents. SQLite stores are checkpointed before staging;
  `auth.json`, `.env`, config, caches and logs remain excluded.
- Kept the existing encrypted, versioned Real-Ming Knowledge Vault and
  materializer available as an optional stronger guarantee. No custom pipeline
  is silently promoted to the native writer.

## Controlled results

- Hermes configuration-pack tests: **17/17 passed**.
- Native-vault backup tests: **2/2 passed**, including nested files, directory
  digest, upload ordering and manifest-last completeness. The native-state
  whitelist and isolated restore coverage also pass.
- TypeScript typecheck, production build and deployment preflight: exit 0.
- Full non-browser suite after the scheduler/version/dashboard/recovery fixes:
  **813 passed**, two intentionally skipped tests; the required Chromium
  dashboard suite: **4/4 passed** outside the sandbox.

## Live acceptance still required

Ming must perform the native Hermes configuration and phone/Obsidian checks:

1. Review the fragment, then apply its non-secret keys with `hermes config set`
   and run `hermes config check` as the `real-ming` service account. Do not
   re-authenticate Codex OAuth.
2. Confirm the native `obsidian` and `llm-wiki` skills are present, create one
   small approved note with a source citation, and retrieve it in a follow-up
   Telegram turn. Verify the file and citation on disk.
3. Restart Hermes and repeat the retrieval. Open the native vault from an
   authorized Obsidian client only after the Azure-local path is proven.
4. Run the protected backup service once and verify the manifest contains the
   native vault files and hashes. Restore to an isolated directory with
   providers, delivery and schedules disabled before calling this milestone
   complete.

The optional curated guarantees (candidate quarantine, atomic compiled
generations and cross-domain CEO projections) remain a separate disposition
decision after this native workflow is observed; they are not counted as
native-memory proof.

## Live deployment update · 7 September 2026

On Malaysia West, Hermes reports `memory_enabled=true`,
`user_profile_enabled=true` and `write_approval=false`. The protected V6
backup and isolated restore now include and verify the native state/profile
files; see the [deployment evidence](RM-40-v6-deployment-evidence-2026-09-07.md).
The note/recall, restart-recall and deliberate memory-write approval checks
remain pending, so milestone 6 is not yet accepted.
