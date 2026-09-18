# diamReserve — Architecture

A production restaurant booking platform with a visual floor plan, Stripe deposits, an admin dashboard, and an offline-capable staff PWA.

## Request flow

| Layer | Responsibility |
| --- | --- |
| Flask 3 + Gunicorn | HTTP entry point — routes, auth, CSRF, rate limiting |
| SQLAlchemy | ORM over MySQL 8 (production) and SQLite (dev) |
| Email worker | Sends confirmations via SMTP/Gmail outside the request path |
| Stripe Checkout | Hosted card payments — server only handles a PCI-safe token |

## Key decisions

- **Stripe Checkout, not raw card handling** — the server never touches card data, so the payment flow stays out of PCI scope.
- **Email worker decoupled** — SMTP latency never slows a booking request.
- **MySQL 8 in production, SQLite in dev** — SQLAlchemy makes the switch a config change.
- **Security as baseline** — PBKDF2 hashing, CSRF protection, rate limiting, secure cookies, CSP and HSTS from the start, not bolted on.
- **Staff PWA** — the floor plan keeps working when the venue Wi-Fi drops.

## Data

Bookings, tables, floor-plan layouts, staff accounts, and payment references live in MySQL 8. Stripe object IDs are stored for reconciliation — never card details.
