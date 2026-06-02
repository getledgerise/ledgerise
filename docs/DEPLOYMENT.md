# Ledgerise Deployment Guide

## Requirements

- Node.js 20+
- PostgreSQL 14+

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://user:pass@host:5432/ledgerise` |
| `LEDGERISE_BOOTSTRAP_ADMIN_EMAIL` | Email for the first admin user (created on startup if not exists) |
| `LEDGERISE_BOOTSTRAP_ADMIN_PASSWORD` | Initial password for the bootstrap admin |

### Optional

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3000` | Port the API listens on |
| `AUTH_TOKEN_SECRET` | `ledgerise-local-development-secret` | HMAC secret for dashboard session tokens — **set a strong random value in production** |
| `DEFAULT_OPERATOR_ID` | — | Override the operator UUID; takes precedence over `DEFAULT_OPERATOR_SLUG` |
| `DEFAULT_OPERATOR_SLUG` | `local-operator` | Slug used to look up the default operator if `DEFAULT_OPERATOR_ID` is not set |
| `INGEST_RATE_LIMIT` | `120` | Max ingest requests per minute per source IP |
| `LEDGERISE_BOOTSTRAP_ADMIN_NAME` | `Ledgerise Admin` | Display name for the bootstrap admin |

## Running Locally

```bash
# Install dependencies
npm install

# Apply database migrations
psql "$DATABASE_URL" -f infra/migrations/0001_initial.sql
psql "$DATABASE_URL" -f infra/migrations/0002_poll_cursors.sql
psql "$DATABASE_URL" -f infra/migrations/0003_posting.sql
psql "$DATABASE_URL" -f infra/migrations/0004_posting_artifacts.sql
psql "$DATABASE_URL" -f infra/migrations/0005_posting_artifact_downloads.sql
psql "$DATABASE_URL" -f infra/migrations/0006_adapters.sql
psql "$DATABASE_URL" -f infra/migrations/0007_access_management.sql

# Seed local operator
psql "$DATABASE_URL" -f infra/seed/0001_local_operator_and_adapters.sql

# Start the API
DATABASE_URL="postgres://..." \
AUTH_TOKEN_SECRET="$(openssl rand -base64 32)" \
LEDGERISE_BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
LEDGERISE_BOOTSTRAP_ADMIN_PASSWORD="changeme123" \
npm run dev -w apps/api

# Start the web dashboard
npm run dev -w apps/web
```

## Health Checks

- `GET /healthcheck` or `GET /api/health` — returns `200 {"status":"ok"}` when healthy, `503` if the database is unreachable.

## First Login

1. Navigate to the dashboard (default: `http://localhost:5173`).
2. Log in with the bootstrap admin credentials.
3. You will be prompted to set a new password on first login.
4. After setting your password you have full admin access.

## Production Checklist

- [ ] Set `AUTH_TOKEN_SECRET` to a strong random value (min 32 bytes, base64 or hex).
- [ ] Set `DATABASE_URL` with SSL parameters: `?sslmode=require` or `?sslmode=verify-full`.
- [ ] Set `LEDGERISE_BOOTSTRAP_ADMIN_PASSWORD` to a temporary value and rotate it on first login.
- [ ] Place the API behind a TLS-terminating reverse proxy (nginx, Caddy, AWS ALB).
- [ ] Configure log aggregation to capture structured JSON from stdout.
- [ ] Set up Postgres connection pooling (e.g. PgBouncer) for production load.
- [ ] Run database migrations in a deploy step before starting the new API version.

## Structured Logs

The API writes newline-delimited JSON to stdout. Each log line has at minimum:

```json
{"timestamp":"2026-06-02T12:00:00.000Z","level":"info","event":"http_request","method":"GET","path":"/api/coa","status":200,"duration_ms":4,"remote_addr":"127.0.0.1"}
```

Key events:

| Event | Level | Description |
|---|---|---|
| `server_start` | info | API process started |
| `http_request` | info | Every HTTP request (method, path, status, duration_ms) |
| `auth_login` | info | Successful dashboard login |
| `auth_login_failed` | warn | Failed login attempt |
| `auth_logout` | info | Dashboard logout |
| `ingest_rate_limit_exceeded` | warn | Source IP exceeded ingest rate limit |
| `health_db_failed` | error | Health check DB probe failed |
| `unhandled_request_error` | error | Unexpected exception in request handler |
