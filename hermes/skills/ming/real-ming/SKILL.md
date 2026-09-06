---
name: real-ming
description: Ming's operating vocabulary, authority boundaries and portfolio. Use when work touches his tasks, calendar, projects, finances, coursework, content or daily operations — not for ordinary conversation.
version: 1.0.0
author: Real-Ming
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Ming, Real-Ming, operations, authority, portfolio]
    related_skills: [coo, cto, personal-cfo, cao, cmo]
---

# Real-Ming

Real-Ming is Ming's private personal-operations umbrella: the shared language
between Ming as CEO and the agents that coordinate his life and business. Use
this skill when the work touches that operation. Skip it for ordinary questions.

## Say it the way he says it

These words carry specific meaning here. Using a synonym loses the distinction.

| Term | Means | Do not call it |
| --- | --- | --- |
| **Real-Ming** | The private umbrella over personal, business, academic and entertainment responsibilities | Ming Creatives, a company |
| **Ming Creatives** | His owned-business domain: app projects, commercial work, content | Real-Ming, personal life |
| **Executive Role** | A bounded delegation identity that becomes active only when work requires it | An always-on agent, a persona |
| **Work Item** | A bounded unit of work with one responsible role and a recorded outcome | A chat, a prompt, an agent run |
| **Master Tasks** | The canonical Notion source holding every operational Work Item | A task view, the old databases |
| **Source of Record** | The external system whose current record is authoritative | A central truth store |
| **Approval** | One explicit CEO decision authorizing one bounded action or exact artifact | A confirmation, an acknowledgement |
| **Money Movement** | Any transfer, payment, charge or trade that changes custody of money | Marking a bill paid, editing a label |
| **Record Change** | Editing application metadata or publishing an approved document version | A payment |
| **Outcome Report** | What was asked, what was done, the evidence, the risks, the decision still needed | A status update, a chat summary |

## Who is accountable for what

Five Executive Roles, each reporting to Ming directly. The COO coordinates but
holds no authority over peers.

| Area | Role | Playbook |
| --- | --- | --- |
| Personal life, career and job | COO | `coo` |
| App and product engineering (Ming Creatives) | CTO | `cto` |
| Money, accounting, assets | Personal CFO | `personal-cfo` |
| Coursework and study outcomes | CAO | `cao` |
| Content strategy and distribution | CMO | `cmo` |

Load a playbook when the work is genuinely in that area. One request usually
needs one. Entertainment has no executive — it is a Trust Domain, not a role.

## Boundaries Ming holds to

- **No Money Movement, ever.** No transfer, payment, card charge, brokerage
  order or trade — regardless of who asks or how routine it looks. Editing a
  DuitSini record is not a payment; sending money is. Say plainly that he has to
  do it himself.
- **Consequential actions stop for an exact Approval.** Production release,
  outbound message, destructive change, permission change, purchase, financial
  Record Change. The Approval binds to the exact artifact — a specific commit, a
  specific message, a specific version. Change the artifact and the Approval is
  void.
- **Sources of Record stay authoritative.** Notion for tasks, Google Calendar
  for events, DuitSini for subscriptions and bills, GitHub for code, Vercel for
  deployments, Agent Brain for project evidence. Read them and cite them. Never
  replace one with your own memory.
- **Academic work assists; it does not submit.** No assignment or exam
  submission, no impersonation, no unsupervised outbound academic messages.
- **No direct production push.** Production changes go through a reviewed pull
  request and an approved exact commit. There is no deploy-latest.
- **Sensitive Secrets stay out.** Credentials, recovery codes, full card
  numbers, transaction passwords and identity documents never enter context,
  memory, notes, logs or a reply.

## Portfolio

**DuitSini** is the live pilot: a deployed finance app and the authoritative
record for subscriptions, renewal schedules, bills and payment-method labels. It
is the first project where the full loop — read the repo, change it, test it,
report it — is expected to work end to end.

Other projects belong to the Project Portfolio with a recorded state (owned
production, owned active, prototype, archived, collaborative, reference). Ask
before assuming a project is live.

## Recording work

Record something when it is worth tracking: real work with an outcome Ming will
want to see later. Do not open a record for a question, and do not let a failed
record silently swallow work that actually happened — if the note did not save,
say the work is done and the record is not.
