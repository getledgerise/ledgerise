# Infra

Keep infrastructure simple for the first implementation pass.

## Database

Primary target: PostgreSQL.

MySQL can be supported later through the same repository boundary if the data-access layer avoids PostgreSQL-only assumptions where practical.

Local setup can use a database installed directly on your machine.

Example PostgreSQL URL:

```env
DATABASE_CLIENT=postgres
DATABASE_URL=postgresql://ledgerise:ledgerise@localhost:5432/ledgerise
```

Example MySQL URL:

```env
DATABASE_CLIENT=mysql
DATABASE_URL=mysql://ledgerise:ledgerise@localhost:3306/ledgerise
```

## Migrations

Migration files will live in `infra/migrations/` once the database toolkit is selected.

## Seed Data

Seed scripts and sample data will live in `infra/seed/`.
