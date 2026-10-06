# API Documentation: diam Enterprise Messenger

## Overview

This document describes the REST API and realtime events for diam Enterprise Messenger. The backend is a FastAPI application (`server/app.py`) served through a Socket.IO ASGI wrapper. HTTP traffic is handled by FastAPI; Socket.IO traffic is handled by `python-socketio`.

All authenticated endpoints require a valid `diam_session` HTTP-only cookie. The cookie is set automatically by `/api/auth/login` and `/api/auth/complete-profile` (and `/api/invitations/{token}/accept`). Include `credentials: "include"` on every `fetch` call.

## Base URL

```
http://localhost:8000
```

In production, use the HTTPS base URL for the deployed instance.

## Authentication

Authentication is session-cookie based. A successful login sets a `diam_session` HTTP-only, `SameSite=Lax` cookie. The server validates the session on every protected request.

### Roles

| Role | Description |
|------|-------------|
| `owner` | Full organisation control; can manage keys, remove admins, set roles. |
| `admin` | Can create channels, invite users, change roles, remove non-owner users. |
| `employee` | Can send messages, join public channels, create DMs, cannot create channels or manage users. |

## Common Response Shapes

- Successful `POST`/`PATCH`/`DELETE` endpoints generally return `{ "ok": true }` or a data object.
- Validation errors return `422 Unprocessable Entity` with Pydantic detail.
- Authorisation failures return `401 Unauthorized` or `403 Forbidden`.
- Not found returns `404 Not Found`.
- Rate-limited paths return `429 Too many requests. Please try again shortly.`

## Rate-Limited Paths

Rate limiting applies to all mutating (non-GET) requests, not just auth. Two tiers (`server/app.py`):

- **Exact paths:** `/api/auth/login`, `/api/auth/mfa/verify`, `/api/auth/password-reset/request`, `/api/organisations`, `/api/auth/verify-code`, `/api/auth/resend-code`, `/api/users/me/totp/enable`, `/api/users/me/totp/disable`.
- **Path prefixes** (dynamic segments collapsed to `{id}` in the bucket key): `/api/channels`, `/api/dm/`, `/api/files`, `/api/messages/`, `/api/admin/`, `/api/invitations`, `/api/users/`, `/api/organisations/`.

Limit: 20 requests per IP per 60 seconds per endpoint bucket. Counters live in Redis when `REDIS_URL` is set (multi-process safe), in-memory otherwise.

---

## Auth Endpoints

### `POST /api/auth/login`

Authenticate with email and password. Sets the session cookie.

**Request**
```json
{
  "email": "user@example.com",
  "password": "string"
}
```

**Response**
```json
{
  "ok": true,
  "csrf_token": "per-session-token",
  "user": {
    "id": 1,
    "first_name": "Ada",
    "last_name": "Lovelace",
    "job_title": "Engineer",
    "department": "Engineering",
    "email": "user@example.com",
    "avatar_path": "avatars/abc.jpg",
    "role": "employee",
    "organisation_id": 1,
    "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" }
  }
}
```

When the account has TOTP enabled, the response is instead:

```json
{ "ok": false, "mfa_required": true, "mfa_token": "short-lived-pending-id" }
```

The `mfa_token` expires after 5 minutes and allows at most 5 verification attempts.

**Errors**: `401` invalid credentials, `403` email not verified, `429` rate limited or account locked (5 failed logins locks the account for 15 minutes).

> **CSRF:** every mutating request made with a session cookie must send the
> `X-CSRF-Token` header containing the `csrf_token` issued at login (also
> returned by `GET /api/auth/me`). Unauthenticated endpoints are exempt and
> rely on Origin/Referer validation plus rate limiting.

### `POST /api/auth/mfa/verify`

Second step of login for TOTP-enabled accounts.

**Request**
```json
{ "mfa_token": "short-lived-pending-id", "code": "123456" }
```

`code` may be the current authenticator code or a one-time backup code (burned on use).

**Response**
```json
{ "ok": true, "csrf_token": "per-session-token", "user": { "id": 1 } }
```

### `POST /api/auth/logout`

Clear the session cookie.

**Response**
```json
{ "ok": true }
```

### `GET /api/auth/me`

Return the current user and organisation summary.

**Response**
```json
{
  "id": 1,
  "first_name": "Ada",
  "last_name": "Lovelace",
  "job_title": "Engineer",
  "department": "Engineering",
  "email": "user@example.com",
  "avatar_path": "avatars/abc.jpg",
  "role": "employee",
  "organisation_id": 1,
  "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" },
  "verified": true,
  "totp_enabled": false,
  "csrf_token": "per-session-token",
  "organisation_name": "diam Systems",
  "organisation_logo": "organisation_logos/def.jpg"
}
```

### `POST /api/users/me/totp/setup`

Begin MFA enrolment. Generates a TOTP secret (stored AES-256-GCM encrypted at
rest) that is inactive until confirmed.

**Response**
```json
{
  "secret": "BASE32SECRET",
  "otpauth_url": "otpauth://totp/diam:user@example.com?secret=...&issuer=..."
}
```

### `POST /api/users/me/totp/enable`

Confirm enrolment with a current authenticator code. Returns 8 one-time backup
codes — shown once, stored hashed.

**Request** `{ "code": "123456" }`
**Response** `{ "ok": true, "backup_codes": ["abcd-1234", ...] }`

### `POST /api/users/me/totp/disable`

Disable MFA with a current TOTP code or a backup code.

**Request** `{ "code": "123456" }`

### `POST /api/auth/password-reset/request`

Request a password reset link/token.

**Request**
```json
{ "email": "user@example.com" }
```

**Response**
```json
{ "ok": true }
```

In development mode, the response also contains `dev_reset_token` for testing.

### `POST /api/auth/password-reset/confirm`

Set a new password using the reset token.

**Request**
```json
{
  "token": "urlsafe-token",
  "password": "newpassword"
}
```

**Response**
```json
{ "ok": true }
```

This also wipes stored E2EE public/private key columns and invalidates all sessions for the user.

---

## Onboarding & Verification

### `POST /api/organisations`

Create the organisation and an unverified owner account. Sends a 6-digit verification code.

**Request**
```json
{
  "organisation_name": "diam Systems",
  "email": "owner@example.com"
}
```

**Response**
```json
{
  "organisation_id": 1,
  "user_id": 1,
  "email": "owner@example.com",
  "dev_verification_code": "123456"
}
```

`dev_verification_code` is only returned in development mode when no email transport is configured.

**Errors**: `400` consumer email domain blocked or existing account.

### `POST /api/auth/verify-code`

Verify the 6-digit code emailed during onboarding.

**Request**
```json
{
  "user_id": 1,
  "code": "123456"
}
```

**Response**
```json
{
  "user_id": 1,
  "email": "owner@example.com",
  "profile_complete": false
}
```

**Errors**: generic `400` for invalid/expired/burned code; `429` after 5 incorrect attempts.

### `POST /api/auth/resend-code`

Issue a fresh verification code and invalidate the previous one.

**Request**
```json
{ "user_id": 1 }
```

**Response**
```json
{ "ok": true }
```

`dev_verification_code` is returned in development mode.

### `POST /api/auth/complete-profile`

Set the user's name, job title, department, and password, then log in.

**Request**
```json
{
  "user_id": 1,
  "first_name": "Ada",
  "last_name": "Lovelace",
  "job_title": "Engineer",
  "department": "Engineering",
  "password": "string"
}
```

**Response**
```json
{ "ok": true }
```

Sets the session cookie.

---

## Organisation & Branding

### `GET /api/organisations/current`

Return the current user's organisation.

**Response**
```json
{
  "id": 1,
  "name": "diam Systems",
  "email_domain": "example.com",
  "logo_path": "organisation_logos/def.jpg",
  "created_at": "2026-06-09T12:00:00+00:00",
  "member_count": 5,
  "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" }
}
```

### `PATCH /api/organisations/current`

Update the organisation name. Admin only.

**Request**
```json
{ "name": "diam Systems Ltd" }
```

**Response**
```json
{ "ok": true }
```

### `POST /api/organisations/current/logo`

Upload an organisation logo image. Admin only.

**Request**: `multipart/form-data` with `file`.

**Response**
```json
{ "logo_path": "organisation_logos/xyz.jpg" }
```

### `GET /api/organisations/{organisation_id}/public-key`

Return the organisation's escrow public key for users to wrap their private-key backups.

**Response**
```json
{ "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" } }
```

### `POST /api/organisations/{organisation_id}/setup-key`

Store the organisation master public key and encrypted private-key backup. Owner/admin only.

**Request**
```json
{
  "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" },
  "salt": "base64salt",
  "encrypted_private_key": { "ciphertext": "...", "iv": "..." }
}
```

**Response**
```json
{ "ok": true }
```

---

## Users

### `GET /api/users`

People directory scoped to the organisation. Optional search query.

**Query**: `?q=ada`

**Response**
```json
[
  {
    "id": 1,
    "first_name": "Ada",
    "last_name": "Lovelace",
    "job_title": "Engineer",
    "department": "Engineering",
    "email": "user@example.com",
    "avatar_path": "avatars/abc.jpg",
    "role": "employee",
    "organisation_id": 1,
    "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" }
  }
]
```

### `GET /api/users/{user_id}`

Public profile for a single user in the same organisation.

### `PATCH /api/users/{user_id}/role`

Change a user's role. Admin only; only an owner can change an owner's role.

**Request**
```json
{ "role": "admin" }
```

### `DELETE /api/users/{user_id}`

Remove a user from the organisation. Admin only; cannot remove the owner or yourself.

**Response**
```json
{ "ok": true }
```

### `POST /api/users/me/avatar`

Upload current user's avatar.

**Request**: `multipart/form-data` with `file`.

**Response**
```json
{ "avatar_path": "avatars/abc.jpg" }
```

### `POST /api/users/me/public-key`

Register or rotate the current user's RSA public key (JWK).

**Request**
```json
{ "kty": "RSA", "n": "...", "e": "AQAB" }
```

**Response**
```json
{ "ok": true }
```

If the public key differs from the stored key, the previous key and backup are moved to `user_key_history`.

### `GET /api/users/me/key-backup`

Return the encrypted private-key backup for the current key.

**Response**
```json
{
  "salt": "base64salt",
  "encrypted_private_key": { "ciphertext": "...", "iv": "..." }
}
```

### `POST /api/users/me/key-backup`

Store an encrypted private-key backup for the current public key.

**Request**
```json
{
  "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" },
  "salt": "base64salt",
  "encrypted_private_key": { "ciphertext": "...", "iv": "..." },
  "encrypted_private_key_org": { "encrypted_key": "...", "ciphertext": "...", "iv": "..." }
}
```

`encrypted_private_key_org` is optional and used for organisation escrow.

### `GET /api/users/me/keys`

Return every encrypted private-key backup for the user (current + archive).

**Response**
```json
{
  "keys": [
    {
      "public_key": { "kty": "RSA", "n": "...", "e": "AQAB" },
      "salt": "base64salt",
      "encrypted_private_key": { "ciphertext": "...", "iv": "..." },
      "encrypted_private_key_org": { "encrypted_key": "...", "ciphertext": "...", "iv": "..." },
      "is_current": true
    }
  ]
}
```

### `POST /api/users/me/keys/archive`

Add a historical key backup without changing the current key.

**Request**: same shape as `/api/users/me/key-backup`.

---

## Invitations

### `POST /api/invitations`

Invite a list of emails to the organisation. Admin only.

**Request**
```json
{ "emails": ["new@example.com"] }
```

**Response**
```json
{
  "invitations": [
    {
      "email": "new@example.com",
      "status": "invited",
      "dev_invite_token": "urlsafe-token"
    }
  ]
}
```

`dev_invite_token` is only returned in development mode.

### `GET /api/invitations`

List invitations for the organisation. Admin only.

### `DELETE /api/invitations/{invitation_id}`

Revoke a pending invitation. Admin only.

### `GET /api/invitations/{token}`

Public lookup of an invitation.

**Response**
```json
{
  "email": "new@example.com",
  "organisation_name": "diam Systems"
}
```

### `POST /api/invitations/{token}/accept`

Accept an invitation and create an employee account.

**Request**
```json
{
  "first_name": "Grace",
  "last_name": "Hopper",
  "job_title": "Engineer",
  "department": "Engineering",
  "password": "string"
}
```

**Response**
```json
{ "ok": true, "user_id": 2 }
```

Sets the session cookie.

---

## Channels

### `POST /api/channels`

Create a channel. Owner or admin only.

**Request**
```json
{
  "name": "general",
  "description": "Team-wide chat",
  "private": false,
  "member_ids": [],
  "channel_keys": {
    "1": { "encrypted_key": "base64-rsa-wrapped-aes-key", "iv": "base64" }
  }
}
```

`channel_keys` is optional but required for E2EE: it is the channel's AES-GCM
key wrapped with each member's RSA public key (keys are `str(user_id)`).
The server stores these as opaque blobs on `channel_members.encrypted_channel_key`.

**Response**: channel object.

### `GET /api/channels`

List visible channels (all public + private the user is a member of). Each
channel includes `has_channel_key` — whether the caller has a wrapped channel key.

### `GET /api/channels/{channel_id}`

Channel detail with member list. Each member includes `public_key` and
`has_channel_key`; the response also includes the caller's own
`encrypted_channel_key` blob when present, which the client unwraps with its
private key to obtain the channel AES key.

### `PATCH /api/channels/{channel_id}`

Update description or add/remove members (private channels). Optionally include
`member_keys` (same shape as `channel_keys`) to provision the channel key for
newly added members.

### `POST /api/channels/{channel_id}/keys`

Distribute wrapped channel keys to members who don't have one yet — e.g. users
who joined after the channel was keyed. Any channel member may call this.

**Request**
```json
{ "keys": { "42": { "encrypted_key": "...", "iv": "..." } } }
```

Only empty key slots are filled; existing wrapped keys can never be
overwritten, so a malicious member cannot substitute another member's key.

**Response** `{ "ok": true, "distributed": <count> }`

### `DELETE /api/channels/{channel_id}`

Archive a channel. Creator or admin only.

### `POST /api/channels/{channel_id}/clear`

Soft-delete all messages in a channel. Creator or admin only.

### `GET /api/channels/{channel_id}/files`

List files attached to messages in the channel.

### `POST /api/channels/{channel_id}/join`

Join a public channel.

---

## Messages

### `GET /api/channels/{channel_id}/messages`

Paginated channel messages.

**Query**: `?before_id=123&limit=50` (max 200)

**Response**
```json
[
  {
    "id": 1,
    "channel_id": 1,
    "sender_id": 1,
    "sender_name": "Ada Lovelace",
    "sender_job_title": "Engineer",
    "sender_avatar": "avatars/abc.jpg",
    "body": "{\"ciphertext\":\"...\",\"iv\":\"...\"}" ,
    "deleted": false,
    "created_at": "2026-06-09T12:00:00+00:00",
    "edited_at": null,
    "files": []
  }
]
```

The `body` is an encrypted JSON blob for both DMs and channels (plaintext
`{ "body": "..." }` is still accepted for backward compatibility). Channel
bodies are AES-GCM encrypted with the channel key; inside the decrypted
envelope is `{ "v": 1, "text": "...", "files": [...] }`. `deleted` messages
have `body: null`.

### `POST /api/channels/{channel_id}/messages`

Send a channel message.

**Request**
```json
{
  "body": "plaintext message",
  "file_ids": []
}
```

Or encrypted:
```json
{
  "ciphertext": "...",
  "iv": "...",
  "tag": "...",
  "file_ids": []
}
```

**Response**: message object.

### `GET /api/dm/{other_user_id}/messages`

DM conversation history.

**Query**: `?limit=50` (max 200)

### `POST /api/dm/{other_user_id}/messages`

Send an encrypted DM.

**Request**
```json
{
  "ciphertext": "...",
  "iv": "...",
  "encrypted_key": "...",
  "encrypted_key_self": "...",
  "file_ids": []
}
```

### `PATCH /api/messages/{message_id}`

Edit a message. Sender only.

### `DELETE /api/messages/{message_id}`

Soft-delete a message. Sender or admin.

### `POST /api/messages/{message_id}/attach/{file_id}`

Attach an already-uploaded file to a message. Sender only.

### `POST /api/dm/{other_user_id}/clear`

Clear all DM messages between the caller and the other user.

### `GET /api/dm/{other_user_id}/files`

List files attached to DMs between the two users.

---

## Files

### `POST /api/files`

Upload a standalone attachment.

**Request**: `multipart/form-data` with `file`.

**Response**
```json
{
  "id": 1,
  "filename": "report.pdf",
  "stored_filename": "uuid4.pdf",
  "path": "1/uuid4.pdf",
  "mime_type": "application/pdf",
  "size": 1024
}
```

### `GET /api/files/{file_id}`

Download an attachment. Requires membership in the channel/DM where the file is used, or same organisation for standalone uploads.

### `GET /api/media/avatars/{filename}`

Public avatar asset.

### `GET /api/media/logos/{filename}`

Public logo asset.

---

## Realtime Events (Socket.IO)

The Socket.IO server runs on the same origin/port. The client loads from a CDN and connects with `withCredentials: true`.

### Connection

The server reads the `diam_session` cookie during the WebSocket handshake. Unauthenticated connections are refused. On connect, the socket joins `org_{organisation_id}` and `user_{user_id}` rooms.

### Client-to-server events

| Event | Payload | Description |
|-------|---------|-------------|
| `typing` | `{ context_type: "channel"|"dm", context_id: number }` | Broadcasts a typing indicator to the organisation room. |

### Server-to-client events

| Event | Payload | Description |
|-------|---------|-------------|
| `message_created` | `{ type, channel_id, message }` | A new channel message was posted. |
| `message_updated` | `{ type, channel_id, message }` | A channel message was edited. |
| `message_deleted` | `{ type, channel_id, message_id }` | A channel message was soft-deleted. |
| `dm_created` | `{ type, participants: [id, id], message }` | A new DM was posted. |
| `history_cleared` | `{ type, channel_id }` | A channel's history was cleared. |
| `dm_history_cleared` | `{ type, participants: [id, id] }` | A DM thread was cleared. |
| `channel_created` | `{ type, created_by, channel_id, channel_name }` | A public channel was created. |
| `user_joined` | `{ type, user }` | A new user completed onboarding. |
| `typing` | `{ type, sender_id, sender_name, context_type, context_id }` | Another user is typing. |
| `channel_rekeyed` | `{ type, channel_id, key_version, rekeyed_by }` | A channel rotated to a new key epoch. |
| `mention` | `{ type, channel_id, channel_name, message_id, sender_id, sender_name }` | You were @-mentioned in a channel. |

The client treats these as "something changed" hints and re-fetches the relevant channel/DM/list to ensure authorisation checks run server-side.

---

## Channel Key Versioning

- `GET /api/channels/{id}` additionally returns `key_version`, `rekey_required`, `key_history` (the caller's wrapped key for every epoch), per-member `key_versions`, and for owner/admin `org_key_history` (the org-escrow copy of every epoch).
- `POST /api/channels/{id}/keys` accepts `{member_id: wrapped}` (current epoch) or `{member_id: {version: wrapped}}` to backfill older epochs. Fill-once only.
- `POST /api/channels/{id}/rekey` (creator/admin) — `{keys: {member_id: wrapped}, org_wrapped_key?}` bumps `key_version`, distributes the new epoch to current members only, and clears `rekey_required`. Returns `{version}`. 409 on a concurrent rotation.
- `POST /api/channels/{id}/messages` accepts `key_version` (epoch the ciphertext was written under) and `mentions` (list of member user ids — plaintext metadata used only to route notifications).

## Search

- `GET /api/search?q=` — returns `{channels, people, files}` matching metadata the caller may see. Message bodies are E2EE and never searched server-side.

## Admin / Compliance

- `GET /api/users/{id}/escrow-backup` (admin) — member's org-escrowed key backups; audit-logged.
- `PATCH /api/organisations/current` — `{name?, retention_days?}`.
- `GET /api/admin/export` (admin) — JSON export of org data (message bodies are ciphertext).
- `POST /api/admin/purge` (admin) — `{confirm: true}` hard-deletes messages older than `retention_days`.
- `GET /api/admin/audit` (admin) — recent audit events.

---

## Error Responses

All errors are returned as JSON:

```json
{ "detail": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation / generic verification error |
| 401 | Not authenticated or session expired |
| 403 | Forbidden (role/permission, unverified, not a member) |
| 404 | Resource not found |
| 422 | Pydantic validation error |
| 429 | Rate limited |
| 500 | Internal server error (no stack trace leaked) |
