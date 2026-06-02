# Data Management: Backup, Restore, and Retention

## Backup

### Logical backup (recommended for most deployments)

Use `pg_dump` to take a consistent logical snapshot:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-acl \
  --no-owner \
  --file="ledgerise-$(date +%Y%m%d%H%M%S).pgdump"
```

`--format=custom` produces a compressed, parallel-restorable file. Store the output in durable object storage (S3, GCS, etc.).

### Continuous WAL archiving (for large or high-volume deployments)

For near-zero RPO, configure Postgres WAL archiving with a tool such as `pgbackup`, `WAL-G`, or `Barman`. Point `archive_command` at your object storage bucket. This enables point-in-time recovery (PITR).

### Recommended schedule

| Frequency | Method | Retention |
|---|---|---|
| Daily | `pg_dump` full logical backup | 30 days |
| Continuous | WAL archiving (if configured) | 7 days of WAL segments |

## Restore

### From a logical backup

```bash
createdb ledgerise_restored
pg_restore \
  --dbname="postgres://user:pass@host:5432/ledgerise_restored" \
  --no-acl \
  --no-owner \
  ledgerise-20260602120000.pgdump
```

Verify the restore before cutting over traffic:

```bash
psql "$RESTORED_DATABASE_URL" -c "SELECT count(*) FROM transactions;"
psql "$RESTORED_DATABASE_URL" -c "SELECT count(*) FROM journal_entries;"
```

### Testing restores

Run a restore drill monthly into an isolated environment. Verify:

1. All migrations applied cleanly (check `schema_migrations` or compare table counts).
2. API health check returns `200`.
3. A sample query across transactions, journal entries, and posting batches returns expected rows.

## Data Retention

Ledgerise accumulates four main categories of audit data. Retention expectations:

| Table | Recommended minimum retention | Notes |
|---|---|---|
| `transactions` | 7 years | Source-of-truth for ingested financial events; required for audit |
| `journal_entries` | 7 years | Accounting records; required for financial audit and reconciliation |
| `posting_batches` / `posting_artifacts` | 7 years | Evidence of what was posted to the general ledger and when |
| `ingestion_errors` | 1 year | Operational diagnostics; can be pruned after resolution |
| `poll_runs` / `poll_cursors` | 90 days | Adapter operations log; short-lived operational data |
| `api_keys` | Retain until revoked + 1 year | Audit trail for key lifecycle |
| `users` | Retain until deactivated + 7 years | Access control audit trail |

### Archival approach

Rather than deleting old rows, move aged rows to a separate archive schema or table partition, or export them to Parquet/CSV in cold storage (S3 Glacier, etc.) before pruning. Keep at least a count and date-range summary in the live database to satisfy audit queries.

### No automatic purge

Ledgerise does not automatically delete any data. All retention and archival must be implemented as an external scheduled job or database-level policy. The API will not prevent reads of aged records.
