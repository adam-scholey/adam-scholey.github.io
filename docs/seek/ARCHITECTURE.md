# Seek — Architecture

Multi-tenant internal search engine with GDPR-compliant cross-border access, consent filtering, and federated connectors.

## Request flow

| Layer | Responsibility |
| --- | --- |
| Flask 3 + Gunicorn | HTTP entry — BCrypt sessions, JWT and API-key auth |
| Search engine | Single / parallel federated queries with consent filtering |
| PostgreSQL | Tenant data — row-level security, regional partitioning, tsvector + pg_trgm indexes |
| Redis | Sessions, caching, distributed locks |
| httpx connectors | Federated fan-out to external PostgreSQL / MySQL / MSSQL sources |

## Key decisions

- **Data sovereignty in the database** — RLS plus regional partitioning means isolation is enforced by Postgres, not application code.
- **Federation over centralisation** — queries fan out to sources in parallel instead of copying data into one index.
- **Postgres search, not Elasticsearch** — tsvector + pg_trgm GIN indexes cover full-text needs without another service to run.
- **Stateless workers** — Redis holds sessions, cache and distributed locks so Kubernetes HPA can scale search workers freely.
- **GDPR by design** — consent management and audit logging are part of the query path, not an afterthought.
