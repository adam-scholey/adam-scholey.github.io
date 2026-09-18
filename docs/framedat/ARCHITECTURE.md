# framed@ — Architecture

Ticketing and event-archive platform for framed@ Limited, a Northern UK arts and music promoter. FastAPI backend, 13 static pages served same-origin, Stripe payments, Cloudflare R2 media storage.

## Request flow

| Layer | Responsibility |
| --- | --- |
| FastAPI + async SQLAlchemy 2.0 | API — auth, checkout, webhooks, scanner, admin, analytics |
| PostgreSQL + Alembic | Orders, tickets, events, users — in-memory SQLite for tests |
| Stripe | Hosted checkout + signed webhooks — idempotent fulfilment, refunds, checkout holds |
| Resend | Transactional email — magic links, 6-digit codes, ticket receipts |
| Cloudflare R2 | Video/image storage — browsers PUT direct via presigned SigV4 URLs |
| ffmpeg task | Re-muxes uploads with `+faststart` so videos seek correctly |

## Key decisions

- **Passwordless auth** — magic links + 6-digit codes via Resend; tokens SHA-256 hashed, single-use, 5-minute TTL, rate-limited per email and IP.
- **Direct-to-R2 uploads** — multi-GB videos never touch the app server or the Postgres volume.
- **moov atom fix** — phone-recorded MP4s stall on raw object storage because the index sits at the end of the file; a background ffmpeg task re-muxes with `-movflags +faststart` (stream copy, no re-encode).
- **Door scanning** — a conditional UPDATE guarantees one admission even under concurrent scans.
- **Hardened frontend** — strict CSP, HSTS, SRI integrity hashes on every script tag, encrypted customer emails at rest, and a cookie-free first-party analytics beacon.
