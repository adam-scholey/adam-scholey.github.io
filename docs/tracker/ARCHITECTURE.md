# Tracker — Architecture

Internal project lifecycle board for the two-person diam Systems team — live updates, GitHub OAuth, email notifications, and a CLI client. Live at diamtracker.fly.dev.

## Request flow

| Layer | Responsibility |
| --- | --- |
| Flask 3 + Gunicorn | Web app + REST API — session auth for web, token auth for CLI |
| SQLite | Single-file persistence on a Fly.io volume |
| Server-Sent Events | One-way live pushes to connected browsers |
| Email worker | Gmail SMTP notifications off the request path |
| tracker CLI | REST client that auto-detects the project from the working directory |

## Deployment

Fly.io — `lhr` region, gunicorn on `:8080`, a `trackerdata` volume mounted at `/data` for SQLite persistence, scale-to-zero. Runs a single gunicorn worker by design so the in-memory SSE client list is shared.

## Key decisions

- **SSE over WebSockets** — updates are one-way, so SSE gives live pushes without socket infrastructure.
- **GitHub OAuth via Authlib** — no passwords to store, and the team already lives in GitHub.
- **plain sqlite3** — the schema is small enough that raw SQL keeps it transparent.
- **One API for UI and CLI** — the web app and `tracker` commands share the same backend.
