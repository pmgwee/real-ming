# V6 Telegram and native-memory acceptance — 6 September 2026

Scope: the existing native Hermes gateway on `real-ming-control-plane-my`
(Malaysia West), Hermes 0.21.0. This records acceptance observations, not a
deployment of the uncommitted milestone 5–9 implementation.

## Product contract and ownership

Ming uses native Hermes through Telegram for readable answers, attachment
understanding and continuity. Hermes owns conversation, rendering and native
memory; this check introduces no Real-Ming replacement or configuration change.
Traceability: ADR-0020, V6 implementation plan milestones 3 and 6.

## User-supplied evidence

- 17:17–17:18 MYT: screenshot attachment correctly interpreted, including
  Agent Plugins heading, folder structure, timestamp 0:35 / 1:35 and counts
  151 / 1. A visible image-tool progress message appeared.
- 17:18–17:19: Blue Lantern / November recalled after an unrelated question.
  Hermes reported a memory update; that report alone is not disk verification.
- 17:25–17:26: `/new` reset confirmed; both facts recalled without being supplied
  in the new question. This proves observed cross-session recall, without
  isolating native memory from other possible retrieval mechanisms.
- 17:30 desktop Telegram screenshots: bold heading, highlighted JavaScript
  block, copy button, preserved indentation/newlines, bullets and inline code
  rendered correctly. Earlier pasted text is not evidence of rendering failure.
- Tool previews are visibly abbreviated; their implementation has not been
  inspected. Telegram's separate typing indicator remains unconfirmed. The
  unexpected “Approved once” message preceding `/new` remains unexplained.

## Multi-step progress observation

At 17:41–17:45 MYT, Ming sent a bounded JavaScript retry-wrapper request. The
native bot visibly emitted staged progress messages, including retry-policy
design, cancellation coverage, syntax/mock checking, a tool-running preview,
an invocation failure explanation, a corrected check, and a final result. The
reply retained headings, bullets, inline code and a fenced JavaScript block.
The request did not create a Work Item, modify a project, call an external
service or deploy anything. The progress/typing acceptance row is therefore
user-observed **passed**. The `Approved once by Jonathan` line was shown as a
tool-approval UX event; its exact approval scope is not independently verified
by this screenshot set.

## Cleanup observation

At 17:34 MYT, Ming sent the approved cleanup request from Telegram. Hermes
displayed its memory-update activity and replied that it removed the
**Blue Lantern / November** profile-memory entry while preserving other
memories and conversation history. This is user-observed acceptance evidence;
the bot's statement is not an independent disk-level inspection. Conversation
history remains intentionally searchable, so finding the words in a later
history search would not contradict the cleanup.

## Authorized service restart

Ming approved the controlled restart with “go ahead” in this conversation.
Private Tailscale SSH confirmed the exact host before mutation.

- Before: `hermes.service` active/running, PID 35299, start 07:06:41 UTC.
- `sudo -n systemctl restart hermes.service`: exit 0.
- After: active/running, PID 37381, start **09:32:43 UTC / 17:32:43 MYT**.
- Subsequent service check and loopback `/health`: exit 0; status `ok`,
  platform `hermes-agent`, version `0.21.0`.

Only the existing Hermes service was restarted. No deployment, OAuth login,
memory deletion or new Telegram test message was performed by this operator.

## Remaining proof

Post-restart Telegram recall is pending Ming's next reply. Ask again without
supplying the facts. A correct response establishes observed continuity through
the restart; it does not prove isolated backup restoration or all milestone 6
requirements. After that check, remove only the imaginary test memory using
Hermes and verify the result. Dashboard and recovery acceptance remain separate.
