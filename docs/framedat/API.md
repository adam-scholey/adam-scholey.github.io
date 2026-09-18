# framed@ API Reference

Interactive API documentation is available in the running application:

- **Swagger UI** (local/staging only): `/api/docs`
- **OpenAPI JSON** (local/staging only): `/api/openapi.json`
- **Static OpenAPI spec**: `openapi.json` in this directory

This document summarises the main endpoints, authentication, and the media flows.
For the request/response model of the auth flows, see `AUTH.md`.

---

## Authentication

### Customers — passwordless

1. `POST /api/auth/magic-links` with `{ "email": "...", "redirect_to": "/my-tickets" }`
2. The API sends a 6-digit code and a single-use link token by email.
3. `POST /api/auth/sessions` with `{ "email", "code" }` or `{ "token" }` to receive the
   `fr_session` session cookie (HttpOnly, SameSite=Lax, Secure in production).
4. Sessions are DB rows — revocation is real; SSE streams revalidate per tick.

### Staff / promoters — email code + passkey MFA

1. `POST /api/auth/magic-links` then `POST /api/auth/sessions` as above.
2. If the staff member has **no** passkey yet, a session is issued immediately
   (first-login bootstrap; they are then prompted to enrol a device).
3. If a passkey exists, the response is `200 { "mfa": "webauthn", "pending": "<id>" }`
   instead of a session. Complete it via one of:
   - `POST /api/auth/webauthn/options` → `navigator.credentials.get()` →
     `POST /api/auth/webauthn/verify` — assertion from an existing passkey
   - `POST /api/auth/webauthn/enrol-options` → `navigator.credentials.create()` →
     `POST /api/auth/webauthn/enrol-verify` — self-enrol a new device and complete
     sign-in in one commit. Triggers an alert email to all active staff.
4. The staff cookie is `fr_staff` (HttpOnly, SameSite=Strict) and satisfies
   `current_staff` for all `/api/admin/*` routes.

### Door scanners

- `POST /api/admin/events/{event_id}/scanner-links` creates a short-lived link.
- `POST /api/scanner/session` redeems the link into a scanner cookie.

---

## Public endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check (DB `SELECT 1`) |
| `GET` | `/api/site/status` | `{ sales_paused, announcement_text }` — drives the site banner + purchase gating |
| `GET` | `/api/events` | List published, upcoming events (incl. `poster_url`, `sales_paused`) |
| `GET` | `/api/events/live` | SSE stream of the events list (~2s tick) |
| `GET` | `/api/events/{slug}` | Event detail and ticket tiers |
| `GET` | `/api/events/{slug}/live` | SSE stream of one event (tiers, `sales_paused`) |
| `GET` | `/api/archive` | Published archive media grouped by event |
| `POST` | `/api/auth/magic-links` | Request customer or staff sign-in email |
| `POST` | `/api/auth/sessions` | Create/verify a session (or receive the `mfa` pending state) |
| `DELETE` | `/api/auth/sessions/current` | Sign out |
| `POST` | `/api/auth/webauthn/options` | Assertion options for a pending staff sign-in |
| `POST` | `/api/auth/webauthn/verify` | Verify assertion → issue staff session |
| `POST` | `/api/auth/webauthn/enrol-options` | Registration options for a pending sign-in |
| `POST` | `/api/auth/webauthn/enrol-verify` | Verify attestation → create credential + session |
| `POST` | `/api/checkout-sessions` | Create a Stripe checkout session (rejected when sales paused) |
| `GET` | `/api/orders/by-session/{session_id}` | Confirm a paid order after Stripe redirect |
| `POST` | `/api/webhooks/stripe` | Stripe webhook (fulfilment is webhook-only, idempotent) |
| `POST` | `/api/analytics/page-views` | Record a page view beacon |
| `POST` | `/api/subscribers` | Join the mailing list |
| `GET` | `/api/subscribers/unsubscribe-customer` | Signed one-click unsubscribe |
| `GET` | `/api/account/orders` | Customer order list (incl. `event_poster_url`) |
| `GET` | `/api/account/orders/live` | SSE stream of the customer's orders |
| `POST` | `/api/account/orders/{order_id}/resend` | Resend QR tickets |
| `GET` | `/api/tickets/{ticket_id}/qr.png` | Ticket QR image |
| `POST` | `/api/scanner/session` | Start a scanner session |
| `POST` | `/api/scanner/scan` | Validate and admit a ticket QR code |

---

## Admin endpoints

All routes are under `/api/admin` and require a staff session.

### Events

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/events` | List all events |
| `GET` | `/api/admin/events/live` | SSE stream of the events list |
| `POST` | `/api/admin/events` | Create an event |
| `GET` | `/api/admin/events/{event_id}` | View an event |
| `PATCH` | `/api/admin/events/{event_id}` | Update an event (incl. `poster_media_id`) |
| `DELETE` | `/api/admin/events/{event_id}` | Delete an event (only if no orders) |

### Media

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/events/{event_id}/media/images` | Upload up to 20 archive images (WebP derivatives) |
| `POST` | `/api/admin/events/{event_id}/media/videos/upload` | Request an R2 presigned PUT URL |
| `POST` | `/api/admin/events/{event_id}/media/videos` | Register an uploaded R2 object or external embed |
| `PATCH` | `/api/admin/media/{media_id}` | Update alt text / order / publish state |
| `DELETE` | `/api/admin/media/{media_id}` | Delete an image or video reference |

### Site settings

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/site/config` | Read the singleton `SiteConfig` |
| `PATCH` | `/api/admin/site/config` | Update `sales_paused` / `announcement_text` |

### Passkeys & staff

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/passkeys` | List the caller's credentials |
| `DELETE` | `/api/admin/passkeys/{id}` | Remove own credential |
| `GET` | `/api/admin/staff` | List staff members |
| `POST` | `/api/admin/staff` | Invite a staff member |
| `PATCH` | `/api/admin/staff/{id}` | Update role / active state |
| `DELETE` | `/api/admin/staff/{id}/passkeys/{credential_id}` | Owner-only: remove another member's passkey (lost-device recovery) |

### Other

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/events/{event_id}/tiers` | Add a ticket tier |
| `PATCH` | `/api/admin/tiers/{tier_id}` | Update a tier |
| `GET` | `/api/admin/orders` | Orders by event or across events |
| `GET` | `/api/admin/tickets` | Tickets by event |
| `POST` | `/api/admin/events/{event_id}/scanner-links` | Create a door scanner link |
| `GET` | `/api/admin/subscribers` | List mailing-list subscribers |
| `POST` | `/api/admin/marketing-emails` | Send marketing email to opted-in customers |

---

## Media upload flows

### Images (incl. event posters)

1. `POST /api/admin/events/{event_id}/media/images` with `files` multipart field.
2. The backend validates content type, resizes to a 4K ceiling, and creates `480`,
   `1080`, and `2160` px WebP derivatives under safe storage keys.
3. To use an image as the event poster, `PATCH /api/admin/events/{event_id}` with
   `poster_media_id` — the image must belong to that event. Public payloads then
   expose `poster_url`.

### Videos (R2, no Cloudflare Stream)

1. `POST /api/admin/events/{event_id}/media/videos/upload` → returns a one-time
   presigned PUT URL (30 min expiry).
2. The browser PUTs the file directly to R2 — the object never transits the server.
3. `POST /api/admin/events/{event_id}/media/videos` with the object key registers it.
   The backend can pull ≤2 GiB objects back briefly to remux `faststart` (ffmpeg,
   15 min cap) so the archive player can start playback immediately.
4. External `embed_url` (Vimeo) also works for hosted video.

---

## Fulfilment guarantees

- Fulfilment is **webhook-only** and idempotent via `processed_stripe_events`.
- Capacity is claimed by an **atomic conditional `sold_count` update before ticket
  rows are written**. A lost race → order `unfulfillable` + `fulfilment_failures`
  row + post-commit Stripe refund (idempotency key on the checkout session id).
- Checkout holds reserve inventory for the payment window; order totals use the
  hold's price snapshot.

## Common error format

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "That event could not be found."
  }
}
```

| Status | Meaning |
|---|---|
| `400` | Validation failure or malformed input |
| `401` | No valid session |
| `403` | Authenticated but not authorised for this action |
| `404` | Resource not found |
| `409` | Conflict with existing state (duplicate slug, event has orders, capacity race) |
| `413` | File too large (images) |
| `503` | External service unavailable (R2 not configured) |

## Rate limits

- Magic links: 10 per email per hour, 50 per IP per hour
- Code/link redemption: 5 failed attempts invalidates the challenge
- Resend ticket emails: 3 per order per hour
- QR scans: 120 per scanner station per minute
- Page view beacons: 120 per IP per minute
