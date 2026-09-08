---
name: knowledge-capture
description: Use when Ming explicitly asks to save a decision or correction, or deliberately marks a project/research artifact for the generated wiki. Capture only the selected claim and its source; do not sweep ordinary conversation or write native Hermes memory.
version: 1.0.0
author: Real-Ming
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Ming, knowledge, capture, Obsidian, LLM-Wiki]
    related_skills: [real-ming, knowledge-consolidation]
---

# Knowledge capture

This is a deliberate intake boundary for the optional generated knowledge
area. Hermes native memory, profile and session history remain authoritative
and unchanged. A normal conversation has no capture signal.

## Capture one durable claim

1. Capture only when Ming says to save, remember as durable knowledge, correct
   an existing claim, or deliberately selects a project/research artifact.
2. Label the claim as `decision`, `project`, or `research` and preserve the
   speaker/source distinction. A source-backed claim is not automatically
   true because its bytes have a matching hash.
3. Include a stable source identity, reference, version, bounded excerpt,
   content hash and `asOf` timestamp. Keep credentials, tokens, private keys,
   and unrelated conversation out of the candidate.
4. Send the candidate through the Real-Ming candidate operation. The registry
   stores bounded metadata and a pointer; it does not become a transcript
   archive or a copy of native memory.

## Forgetting

An explicit “forget this” request is a suppression operation, not routine
memory housekeeping. Report only the operation result returned by the
forgetting boundary. It must prevent new candidate admission and supported
wiki retrieval promptly; native Hermes memory and session history are outside
this wiki guarantee unless Hermes handles them through their own native
commands.

## Completion criterion

The candidate is either explicitly ignored, denied with a reason, or admitted
idempotently with an opaque candidate ID and source metadata. Never claim a
published page or native-memory change at capture time.
