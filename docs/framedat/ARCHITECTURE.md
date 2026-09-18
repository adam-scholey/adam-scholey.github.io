# framed@ — Architecture

Ticketing platform for framedat.uk: passwordless customer auth, passkey-MFA staff admin,
Stripe checkout, QR ticket delivery, door scanning, and an archive of event media.

## Shape

```
Browser (vanilla JS)  ──►  FastAPI (async)  ──►  PostgreSQL (SQLAlchemy 2 async)
   pages/ + js/            app/                  Alembic migrations
        │                     │
        │                     ├─► Stripe (hosted checkout + webhooks)
        │                     ├─► Resend / MailerLite (email)
        │                     └─► Cloudflare R2 (images + videos, presigned PUT)
        │
        └──── SSE: /api/events/live, /api/events/{slug}/live,
                  /api/account/orders/live, /api/admin/events/live
```

No build step. Static pages in `pages/`, scripts in `js/`, styles in `css/` served
same-origin. Frontend state lives in the DOM + `localStorage` hints only.

## Backend layout

- `app/main.py` — app factory: routers, middleware (request-id, security headers),
  error handlers, CORS (off by default), static mounts.
- `app/routers/` — `events`, `checkout`, `webhooks`, `auth`, `account`, `scanner`,
  `media`, `site`, `subscribe`, `analytics`, `admin/`.
- `app/routers/admin/` — `events`, `tiers`, `orders`, `tickets`, `marketing`,
  `settings`, `staff`, `passkeys`, `scanner`, `subscribers`, `common`.
- `app/services/` — `fulfilment`, `stripe_service`, `media_service`, `video_service`,
  `webauthn_service`, `site_config`, `email_service`, `qr_service`, `slug`,
  `availability`, `analytics_service`, `mailerlite_service`.
- `app/jobs/` — `reminders` (event reminders), `rollup` (traffic/challenge/session GC).
- `app/models.py` — single module, ~25 tables.
- `app/dependencies.py` — `current_customer`, `current_staff`, scanner context, db.

## Key flows

**Purchase → fulfilment (webhook-only, idempotent)**
1. `POST /api/checkout-sessions` creates a `CheckoutHold` (reserves inventory,
   price snapshot) and a Stripe Checkout session; rejected when `sales_paused`.
2. Stripe redirects back → `GET /api/orders/by-session/{id}` shows confirmation.
   **The order is not fulfilled here** — only the webhook fulfils.
3. `POST /api/webhooks/stripe` → `fulfilment.fulfil()`:
   - Dedupes via `processed_stripe_events`.
   - Claims capacity with an **atomic conditional `sold_count` update before
     ticket rows are written**.
   - Lost race → order `unfulfillable` + `fulfilment_failures` row + post-commit
     Stripe refund (idempotency key on the checkout session id).
4. Tickets get QR tokens (`build_ticket_token`); emails send post-commit.

**Real-time (SSE, not WebSockets)**
Four streams poll the DB on a tick and push changed payloads only:
public events (2s), single event (2s), customer orders, admin events.
`sales_paused`/`announcement_text` ride the event ticks so open pages converge
without reload. Authenticated streams revalidate the session each tick and close
if it was revoked.

**Media**
- Images: validated upload → 4K ceiling → 480/1080/2160 WebP derivatives →
  `MediaAsset` rows with safe storage keys → `MEDIA_BASE_URL/{key}.webp`.
- Posters: `events.poster_media_id` → `media_assets`; must belong to the event.
- Videos: presigned R2 PUT (never transits the server), optional ≤2 GiB remux to
  `faststart` via ffmpeg, or external Vimeo embed. **No Cloudflare Stream.**

**Site pause**
`SiteConfig` singleton (`sales_paused`, `announcement_text`). `/api/site/status`
drives the fixed banner + checkout guard + purchase-form gating; the admin PATCH
flips it and SSE propagates.

## Auth model (summary — see AUTH.md)

- Customers: magic link / 6-digit code → `fr_session` (SameSite=Lax).
- Staff: email code → passkey assertion or self-enrolment → `fr_staff` (Strict).
- Scanners: per-event short-lived link → scoped scanner cookie.
- Sessions are DB rows → revocation real; SSE revalidates per tick.

## Concurrency invariants

- Checkout holds + atomic `sold_count` claim → no oversell; losers get refunded.
- Rate-limit writes commit in their own transaction (`get_db_session_factory`) so a
  request rollback can't erase them.
- Magic-link codes are HMAC-keyed hashes; challenges are single-use and
  five-fail-invalidated.
- PostgreSQL advisory locks (`pg_advisory_xact_lock`) serialise sensitive buckets.

## Config

Pydantic `Settings` from `.env`: `DATABASE_URL`, `SECRET_KEY`, `BASE_URL`,
Stripe/Resend/R2 keys, `ENVIRONMENT` (gates Secure cookies, HSTS, `/api/docs`),
`CORS_ORIGINS` (empty default), `MEDIA_*`, `TRUSTED_PROXIES`.

## Testing

- `tests/` — SQLite by default (`aiosqlite`); 90 tests.
- `TEST_DATABASE_URL` + `TEST_DB_SCHEMA` runs the same suite against real Postgres;
  `test_concurrency_pg.py` only runs there (real row-locking).
- `npx eslint js/` for frontend lint; `ruff check app tests` (B008 `Depends`
  baseline exists).
