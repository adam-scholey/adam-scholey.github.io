# framed@ — Database Architecture & Security Procedures

PostgreSQL in production (asyncpg), SQLite in tests. SQLAlchemy 2 async ORM,
Alembic migrations. ~25 tables in `app/models.py`.

## Schema map

```
events ──┬── ticket_tiers ──── checkout_holds ──► orders ──► tickets
         │      (capacity,                        │            (QR token,
         │       sold_count)                      │             used_at, cancelled)
         ├── media_assets ◄── events.poster_media_id
         ├── scanner_links ──► scan_records
         └── event_reminders

customers ──┬── sessions (fr_session / fr_staff)
            ├── orders
            ├── magic_link_challenges (HMAC-hashed codes, single-use)
            └── subscribers (marketing_opt_in)

staff_members ──┬── webauthn_credentials (passkeys)
                └── webauthn_challenges (single-use ceremonies)

ops ── site_config (singleton) · processed_stripe_events · audit_entries
       rate_limit_hits · page_views · daily_traffic · fulfilment_failures
```

## Integrity rules enforced in the DB (not just the app)

- `ticket_tiers`: `sold_count <= allocation`, `sold_count >= 0`,
  `price_pence >= 0`, `allocation > 0` — **oversell is impossible at the row level**
- `orders`: `total_pence >= 0`
- `checkout_holds`: `quantity > 0`
- `sessions`: typed check (customer vs staff)
- `media_assets`: images need `storage_key`; videos need `storage_key` OR `embed_url`
- Unique constraints on slugs, credential IDs, Stripe event IDs

## Concurrency design

| Hazard | Mechanism |
|---|---|
| Oversell race | Atomic conditional `UPDATE ticket_tiers SET sold_count = sold_count + n WHERE sold_count + n <= allocation` **before** ticket rows exist. Loser → `unfulfillable` + refund |
| Webhook replay | `processed_stripe_events` — event ID recorded before fulfilment; replays no-op |
| Refund replay | Stripe idempotency key on the checkout session ID |
| Serialized critical sections | `pg_advisory_xact_lock(hashtext(:bucket))` — dies with the transaction |
| Hold expiry | `expires_at` + `consumed_at` indexes; unclaimed capacity frees itself |
| Rate-limit erasure | Rate-limit writes commit in their **own transaction** (`get_db_session_factory`) — a request rollback can't delete the evidence |

## Indexes

- `events(is_published, starts_at)` — public listing
- `ticket_tiers(event_id, display_order)` — tier rendering
- `checkout_holds(tier_id|customer_id, expires_at, consumed_at)` — hold GC + lookups
- `orders(customer_id|event_id, created_at)` — account + admin views
- `tickets(event_id, used_at)`, `tickets(order_id)` — scanning + orders
- `magic_link_challenges(email|request_ip, created_at)` — rate limiting
- `scanner_links(event_id, revoked_at, expires_at)` — live link lookup

## Security procedures

### Access control

- App connects as **`framed`** — non-superuser, no `CREATEROLE`/`CREATEDB`, owns
  only the `framed` DB schema (verified live).
- **No Row-Level Security** — deliberately. Authorization lives in the app layer
  (`current_customer` / `current_staff` / scanner deps). RLS would duplicate
  authz logic and create a second place to get it wrong. Don't add it.
- No raw SQL except the parameterized advisory-lock call — everything else is
  ORM-bound (no string concatenation → no SQLi surface).

### Secrets at rest

- Magic-link codes stored as **HMAC-keyed hashes** — a DB leak can't redeem them
- Session tokens hashed; only the client holds the raw value
- WebAuthn challenges single-use + expiring
- Customer PII is minimal by design: email, display name, order history
- Card data **never touches the DB** — Stripe-hosted checkout only

### Production hardening checklist

Provisioning steps for the live Postgres (see
`postgres-production-checklist.md` for the full runbook):

1. **Bind privately** — `listen_addresses` to localhost or the VPC interface;
   dev box currently listens on `*` (fine locally, not in prod)
2. **SSL on** — `ssl=on` in `postgresql.conf` + `sslmode=require` in `DATABASE_URL`
3. **`pg_stat_statements`** in `shared_preload_libraries` — query visibility,
   catches scraping/brute-force patterns
4. **`pgAudit`** — `pgaudit.log = 'ddl, write'` for a compliance-grade trail
   without logging every SELECT
5. **Backups** — `pg_dump`/WAL archiving on a schedule; test a restore before launch
6. **PgBouncer** (optional) — pool connections under SSE fan-out
7. **Separate prod credentials** — new `framed` password, never the dev one

### Operational hygiene

- Migrations via Alembic only — never hand-edit the live schema
  (head: `f5a6b7c8d9e0_event_poster_media`)
- `jobs/rollup.py` garbage-collects expired challenges, holds, sessions
- `audit_entries` records staff mutations; `fulfilment_failures` is the durable
  record for every refund-triggering capacity loss
- `enforce_rate_limit` on auth/scan/beacon endpoints — hits persist across
  request rollbacks by design

## What to watch in production

- `fulfilment_failures` — every row is a real refund that should have landed
- `rate_limit_hits` spikes — brute-force signal
- `pg_stat_statements` — slow/unusual query shapes
- `audit_entries` — staff action trail
