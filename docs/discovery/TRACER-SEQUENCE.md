# Phase 1 Tracer Sequence

This is a discovery record for rollout order, not authorization to implement or deploy.

## Tracer 1: Daily Operations Loop

The first working slice contains:

- the private Telegram front door;
- Google Calendar as the calendar Source of Record;
- migration of the five confirmed Notion task databases into Master Tasks;
- CEO, COO, CFO, CAO, CTO, and CMO Work Views;
- the 07:30 Asia/Kuala_Lumpur morning brief;
- task capture, routing, reprioritization, and write-back;
- the 21:30 Asia/Kuala_Lumpur Executive Roll-Up;
- Approval and audit recording.

Email, finance integrations, and application-code execution follow only after this tracer is reliable.

## Tracer 2: DuitSini MicroSaaS Operations Loop

The first application pilot is `C:\Users\quekm\Desktop\projects\subscription-agent`, deployed as DuitSini and already Evidence-Enabled. The loop is CEO request, CTO Work Item, task branch, implementation and tests, draft pull request, Vercel preview, Outcome Report, CEO Approval of an exact commit, merge, production verification, and final report. Preview and test work must not expose production financial metadata, and database or production-data changes require separately scoped Approval.

The pilot begins with one bounded CEO-selected update. Its exact product change is captured as the first implementation Work Item and is not a blocking Phase 1 architecture decision.
