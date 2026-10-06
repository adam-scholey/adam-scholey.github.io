# ADR-002: PostgreSQL with Row-Level Security for Multi-Tenancy

## Status

Accepted

## Date

2026-06-09

## Context

diam Enterprise Messenger is meant to be multi-tenant. Each organisation must be strictly isolated from every other organisation. The initial prototype used SQLite, which has no built-in row-level security. We need a production database that can enforce tenant isolation at the database layer while retaining an easy local development option.

## Decision

1. Use **PostgreSQL** as the production database.
2. Keep **SQLite** as a fallback for local development and automated tests.
3. Implement **Row-Level Security (RLS)** policies on all tenant-scoped tables in PostgreSQL.
4. Pass tenant context through a `ContextVar` (`current_org_id`) and apply it per Postgres connection via `SET LOCAL app.current_org_id`.
5. Allow RLS bypass (`SET LOCAL app.bypass_rls = 'on'`) during login/onboarding when the tenant is not yet known and during `init_db` when creating schemas and policies.
6. Maintain a single SQL dialect across SQLite and PostgreSQL by translating `?` placeholders to `%s` in a `PostgresCursor` wrapper and auto-appending `RETURNING id` for inserts.

## Alternatives Considered

### SQLite-only with application-level tenancy

- **Pros**: Zero infrastructure, easy for prototypes.
- **Cons**: No defence-in-depth at the database layer; harder to scale horizontally.
- **Rejected**: Does not meet the production multi-tenant requirement.

### Separate database per tenant

- **Pros**: Strongest isolation.
- **Cons**: Operational complexity, connection pooling, migrations, and backups become harder.
- **Rejected**: Overkill for the current scale and adds unnecessary ops burden.

### MySQL

- **Pros**: Mature, widely supported.
- **Cons**: Less flexible RLS story than PostgreSQL at the time of decision; weaker JSON and full-text features.
- **Rejected**: PostgreSQL's RLS and JSONB capabilities are a better fit.

## Consequences

- Every query can be scoped by `organisation_id` at the application level and enforced by RLS at the database level.
- Local development can still run with SQLite if Docker is unavailable.
- The codebase must keep the SQLite and PostgreSQL schemas in sync.
- `current_org_id` must be set correctly on every authenticated request; forgetting to set it could bypass RLS if `app.bypass_rls` is enabled.
- Migrations must be duplicated: schema definitions plus `ALTER TABLE` migrations for additive changes.

## Related Files

- `server/database.py`
- `docker-compose.yml`
- `.env.example`
- `server/auth.py`
