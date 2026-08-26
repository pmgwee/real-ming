# Retain audit and purge ingestion staging

Verified raw ingestion staging files are deleted after 30 days, active Personal Context projections remain while current, and superseded personal projections are retained for 12 months. Financial Snapshot versions, CEO Approvals, Outcome Reports, and audit events are retained indefinitely for v1; Sensitive Secrets never enter tasks, prompts, outcomes, or audit logs, and deleted Context Vault data must age out of backups within 30 days.
