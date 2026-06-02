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

## Generic Poll Runner

Run one poll attempt and exit:

```bash
DATABASE_URL="postgresql://localhost:5432/ledgerise" RUN_GENERIC_POLL_ON_START=true npm run start -w apps/worker
```

Run the scheduler:

```bash
DATABASE_URL="postgresql://localhost:5432/ledgerise" RUN_GENERIC_POLL_SCHEDULE=true npm run start -w apps/worker
```

Environment knobs:

- `GENERIC_POLL_ADAPTER_NAME`: adapter name, defaults to `generic-poll`.
- `GENERIC_POLL_INTERVAL_MS`: normal interval, defaults to 15 minutes.
- `GENERIC_POLL_RETRY_BASE_DELAY_MS`: first retry delay after a failed run, defaults to 1 minute.
- `GENERIC_POLL_MAX_RETRY_DELAY_MS`: retry delay cap, defaults to the normal interval.
- `GENERIC_POLL_RUN_IMMEDIATELY`: set `false` to wait one interval before the first scheduled run.

The runner advances the saved sync position only after fetched records are ingested or safely classified as duplicates.
