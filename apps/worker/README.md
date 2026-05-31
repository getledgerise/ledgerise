# Ledgerise Worker

Background processor for Ledgerise.

Responsibilities:

- Scheduled poll adapter runs
- Journal engine runs
- Outbound posting dispatch
- Posting retries
- Adapter health checks
- COA sync jobs

Worker jobs must be idempotent. Re-running a job must not double-post a transaction.
