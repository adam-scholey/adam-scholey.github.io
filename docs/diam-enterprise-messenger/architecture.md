# Architecture Documentation: diam Enterprise Messenger

## Overview

diam Enterprise Messenger is a multi-tenant business messaging platform. The current implementation is a Python FastAPI backend with a vanilla JavaScript frontend, PostgreSQL (or SQLite) persistence, Redis-optional realtime messaging, and client-side end-to-end encryption for direct messages and channels (versioned channel key epochs - see `arch.md` for the diagram-oriented overview).

The system is designed around a few core principles:

1. **Tenant isolation at the database layer** using PostgreSQL Row-Level Security.
2. **No plaintext message keys on the server** for direct messages.
3. **Server-side session revocation** through opaque session cookies rather than JWTs.
4. **Dev/prod parity** via Docker Compose and environment-driven configuration.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (vanilla JS)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   web/app.js │  │ web/crypto.js│  │ Socket.IO client (CDN)   │  │
│  │  UI + router │  │ E2EE + keys  │  │ realtime events          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FastAPI + Socket.IO                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  HTTP routes │  │ Auth/session │  │  Socket.IO server        │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                    │
│  organisations  users  channels  messages  files  database  auth │
└─────────────────────────────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
    ┌──────────┐            ┌──────────┐            ┌──────────┐
    │Postgres  │            │  Redis   │            │Filesystem│
    │  + RLS   │            │ (optional│            │ storage  │
    │          │            │ broker)  │            │          │
    └──────────┘            └──────────┘            └──────────┘
```

## Backend Components

### `server/app.py`

Application entry point. Creates the FastAPI app, attaches middleware, includes routers, and mounts static files. The final ASGI app is `socketio.ASGIApp(sio, other_asgi_app=fastapi_app)`, meaning Socket.IO handles WebSocket traffic and falls through to FastAPI for HTTP.

Middleware:

- `RateLimitMiddleware`: in-memory per-IP rate limiting for auth/onboarding/verification endpoints.
- `SecurityHeadersMiddleware`: adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- `NoCacheMiddleware`: disables caching for HTML and static assets during development.

### `server/database.py`

Dual database backend:

- **SQLite**: default for local development and tests. Enables foreign keys, WAL mode, and stores the file at `database/diam.db`.
- **PostgreSQL**: enabled when `DIAM_DATABASE_URL` is set and reachable. Falls back to SQLite if Postgres is not reachable.

`PostgresConnection` / `PostgresCursor` translate SQLite `?` placeholders to psycopg2 `%s` and auto-append `RETURNING id` so the code can use the same SQL dialect for both backends.

**Row-Level Security** policies isolate tenants by `organisation_id` using Postgres `current_setting('app.current_org_id')`. When `current_org_id` is `None`, `app.bypass_rls` is set to `on` (used during login, onboarding, and `init_db`).

### `server/auth.py`

- Argon2id password hashing and verification.
- Opaque session creation and cookie management.
- FastAPI dependencies: `get_current_user`, `require_verified`, `require_admin`, `require_owner`.

Sessions are stored in the `sessions` table with a random `id`, 14-day expiry, and are validated on every request. The cookie is `HttpOnly`, `SameSite=Lax`, and `secure=False` for local HTTP (must be `True` in production).

### `server/organisations.py`

Organisation onboarding, branding, invitations, and escrow key setup. Email verification uses 6-digit codes with attempt limiting and expiry. Invitations are 24-hour tokens. Owners/admins can revoke pending invitations.

### `server/users.py`

Login/logout, current user, password reset, avatar upload, public-key registration, key backup/archive, people directory, and admin user management (role change, removal).

### `server/channels.py`

Channel CRUD, membership, visibility rules, and history clearing. Private channels are invisible and inaccessible to non-members. Channel creation is restricted to owners and admins.

### `server/messages.py`

Channel and DM message endpoints, edit/delete, file attachment linking, and history clearing. Channel messages currently accept legacy plaintext or encrypted payloads; DM messages are expected to be encrypted client-side.

### `server/files.py`

File upload, storage, and serving. Images are re-encoded with Pillow to strip metadata and resize. Files are saved with `0o644` permissions and served only through authenticated endpoints with membership checks.

### `server/realtime.py`

`python-socketio` server with optional Redis broker. Authenticates via the session cookie at connect time and joins rooms by organisation and user. Broadcasts events for messages, channels, users, typing, and history clears.

### `server/crypto.py`

Server-side helpers for base64url encoding, JWK validation, and encrypted payload validation/serialization. The server does not perform message decryption; it only validates shape and stores opaque encrypted blobs.

### `server/mailer.py`

Email abstraction with priority: Resend API → SMTP → development mode (log + surface token in response).

## Frontend Components

### `web/index.html`

Main application shell. Contains the sidebar, main content area, modals, notification panel, and loading screen.

### `web/app.js`

Vanilla JavaScript SPA. Handles:

- Boot and session check.
- E2EE key initialisation.
- Socket.IO connection and realtime event handling.
- Routing between home, people, channel, DM, and admin views.
- Rendering channel/DM message lists, composer, file uploads, and member management.
- Notification bell and unread counters.
- Admin panel (invitations, role changes, user removal).

### `web/crypto.js`

`CryptoManager` and helper functions for client-side cryptography:

- RSA-OAEP 2048 key pair generation and JWK import/export.
- AES-GCM message and file encryption.
- PBKDF2-SHA-256 password-derived key derivation.
- Private-key backup encryption (with optional organisation escrow wrapping).
- Multi-key private-key archive for cross-device history.
- Public-key fingerprinting and trusted-key storage.

### `web/api.js`

Thin `fetch` wrapper that sends `credentials: "include"` and handles JSON parsing/error extraction. Also contains shared helpers for HTML escaping, initials, date parsing, and avatar/logo URLs.

## Data Flow

### Onboarding (owner)

1. `POST /api/organisations` creates org + unverified owner and emails a 6-digit code.
2. `POST /api/auth/verify-code` verifies the code.
3. `POST /api/auth/complete-profile` sets name/job/password and issues a session.
4. Browser generates an organisation RSA key pair and posts it to `/api/organisations/{id}/setup-key`.
5. Browser generates a user RSA key pair, encrypts the private key with the owner's password, wraps it with the org public key, and posts to `/api/users/me/public-key` + `/api/users/me/key-backup`.

### Login

1. `POST /api/auth/login` validates the password. Accounts with TOTP enabled
   get `{mfa_required, mfa_token}` instead of a session and must complete
   `POST /api/auth/mfa/verify` (current TOTP code or a one-time backup code).
2. On success a session row is created bound to the client IP and User-Agent
   (SHA-256 hashes); either changing invalidates the session. A per-session
   CSRF token is returned and must be sent as `X-CSRF-Token` on all mutating
   authenticated requests. A new-IP sign-in triggers an email alert.
3. Browser fetches `/api/users/me/keys` and decrypts every archived private key with the password.
4. Browser uses the recovered key material for DM decryption.

### Sending a Direct Message

1. Browser fetches the recipient's public key from `/api/users/{recipient_id}`.
2. Browser warns if the key differs from a trusted fingerprint.
3. Browser generates an AES message key and encrypts the message body.
4. Browser wraps the AES key with the recipient's RSA public key and the sender's own RSA public key.
5. Browser POSTs `{ciphertext, iv, encrypted_key, encrypted_key_self, file_ids}` to `/api/dm/{recipient_id}/messages`.
6. Server stores the encrypted blob and broadcasts `dm_created` to the organisation room.

### Sending a Channel Message

1. The browser ensures it holds the channel AES-GCM key (`ensureChannelKey`):
   memory/IndexedDB → its `encrypted_channel_key` on the channel record → or,
   if no member has a key yet, it generates one and wraps it for every member
   with a public key via `POST /api/channels/{id}/keys`.
2. The browser encrypts the `{v:1, text, files}` envelope with the channel key
   and POSTs `{ciphertext, iv, file_ids}`.
3. Server stores the opaque blob and broadcasts `message_created`.
4. Members who join later get the key lazily: any member holding the key wraps
   it for members whose `channel_members.encrypted_channel_key` slot is empty.
   Slots can only be filled once (no overwrite → key-substitution defence).
5. Channel attachments use a per-file AES key wrapped with the channel key
   inside the message envelope (`files[].channel_key`).

> **Note:** Channel re-keying on member removal is not implemented - a removed
> member retains previously-distributed key material. A rotation endpoint is
> tracked as a gap.

### File Attachments

1. For DMs, the browser encrypts the file with a random AES-GCM key, wraps the key for recipient + sender, and uploads the encrypted file bytes to `/api/files`.
2. The server stores the encrypted file on disk under `server/storage/attachments/{org_id}/`.
3. When creating a message, the browser sends `file_ids`; the server links the files to the message.
4. On download, the browser fetches `/api/files/{file_id}` and decrypts locally.

## Security Model

### Authentication & Authorisation

- Passwords are hashed with Argon2id.
- Session cookies are server-side opaque tokens; logout deletes the row.
- Password reset invalidates all sessions and clears stored E2EE public/private key columns.
- FastAPI dependencies enforce role and membership checks.

### Multi-Tenancy

- Application code scopes every query by `organisation_id`.
- PostgreSQL RLS policies provide a defence-in-depth layer.
- The `current_org_id` ContextVar is set from the session on every authenticated request.

### E2EE

- **Direct messages**: encrypted with AES-GCM, keys wrapped with RSA-OAEP for recipient and sender.
- **Channel messages**: plaintext on the server in current implementation.
- **Files in DMs**: encrypted client-side with per-file AES keys wrapped for both parties.
- **Files in channels**: not yet encrypted for channel members.
- **Key backups**: encrypted with the user's password-derived AES key and optionally with the organisation public key for escrow.
- **Key history**: all previous private keys are archived so old messages remain decryptable after key rotation.

### Communications

- Socket.IO with `withCredentials: true` and origins limited to localhost/127.0.0.1 in development.
- Redis broker optional for horizontal scaling.

### File Security

- MIME type and size whitelists.
- Images re-encoded with Pillow to strip metadata.
- Server-generated filenames (UUID), no executable bits.
- Path traversal checks on serve.
- Attachments served only through authenticated endpoints.

## Deployment Model

### Docker Compose (development)

```yaml
services:
  db: postgres:16 on host port 5433
  redis: redis:7-alpine on host port 6380
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `DIAM_DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis broker for Socket.IO |
| `DIAM_RESEND_API_KEY` | Resend API key |
| `DIAM_RESEND_FROM` | Resend sender address |
| `BASE_URL` | Base URL for email links |
| `DIAM_SMTP_*` | Optional SMTP fallback |

### Running Locally

```bash
docker compose up -d
python -m venv venv
venv\Scripts\activate  # or source venv/bin/activate on Unix
pip install -r requirements.txt
uvicorn server.app:app --reload --port 8000
```

### Running Tests

```bash
python -m pytest -q
```

Tests use an isolated temporary SQLite database and do not require Docker.

## Scalability & Future Work

- **Horizontal scaling**: enable Redis (`REDIS_URL`) so Socket.IO can broadcast across processes.
- **Rate limiting**: replace in-memory buckets with Redis-backed limits.
- **Channel E2EE**: implement shared channel keys, member wrapping, and rekeying on membership changes.
- **Secure key storage**: move from `localStorage` to IndexedDB or non-exportable Web Crypto keys.
- **Forward secrecy**: evaluate Messaging Layer Security (MLS) or a ratchet design for long-term security.
- **Push notifications**: integrate Web Push for PWA/mobile.

## See Also

- `documentation/api.md` - endpoint reference.
- `documentation/progress.md` - current status and roadmap.
- `documentation/developer-guide.md` - local development and conventions.
- `documentation/decisions/` - architecture decision records.
