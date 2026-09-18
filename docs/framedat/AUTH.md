# framed@ — Authentication & Sessions

Everything here is passwordless. There are no passwords anywhere in the system —
customers use email codes/links, staff add a passkey on top, scanners use links.

## Cookies

| Cookie | Who | SameSite | Notes |
|---|---|---|---|
| `fr_session` | Customers | Lax | DB-backed session, revocable |
| `fr_staff` | Staff | Strict | DB-backed session, revocable |
| scanner cookie | Door staff | — | Scoped to one event, short-lived |

All are `HttpOnly` and `Secure` in production (`ENVIRONMENT=production`).

## Customer sign-in

```
POST /api/auth/magic-links   { email, redirect_to }
        │
        ├─► Email with a 6-digit code + a single-use link token
        │
POST /api/auth/sessions      { email, code }  OR  { token }
        │
        └─► 200 + fr_session cookie   (customers complete here)
```

- Codes are HMAC-keyed hashes — a DB leak alone can't brute-force them.
- Challenges are single-use; 5 failed attempts invalidate them.
- Rate limits: 10 links/email/hour, 50/IP/hour, plus redemption limits.
- The magic link opens in the same browser/tab — the code entry stays in flow.

## Staff sign-in (email code + WebAuthn MFA)

Same magic-link + `POST /api/auth/sessions`, then it forks:

```
staff member has a passkey?
   │
   ├─ NO  ──► session issued (first-login bootstrap)
   │          → admin UI prompts "Set up this device" → enrol-options/create/verify
   │
   └─ YES ──► 200 { "mfa": "webauthn", "pending": "<pending_id>" }
              │
              ├─ Assertion path ──► POST /api/auth/webauthn/options
              │                    navigator.credentials.get()  (Face ID / Hello / PIN)
              │                    POST /api/auth/webauthn/verify → fr_staff cookie
              │
              └─ Enrol path ─────► POST /api/auth/webauthn/enrol-options
                                   navigator.credentials.create()
                                   POST /api/auth/webauthn/enrol-verify
                                   → credential + fr_staff in one commit
                                   → alert email to ALL active staff
```

### Client-side flow control (`js/admin.js`, `js/login.js`)

- `localStorage["framed_passkey_seen"]="1"` records that a ceremony succeeded in
  this browser → next login goes straight to the OS `get()` sheet (Face ID directly).
- No flag → we offer "Set up this device" **before** calling `get()`, skipping the
  OS QR/security-key fallback sheet on devices that have nothing to find.
- Enrolment failure falls back to `get()` silently — covers "passkey exists but the
  flag was cleared" (iOS `excludeCredentials` refusal).
- `isUserVerifyingPlatformAuthenticatorAvailable()` preflights enrolment so in-app
  browsers/webviews get a clear "open in Safari/Chrome" message.

### WebAuthn rules

- RP ID derived from `BASE_URL`/`request` — `localhost` for loopback dev, canonical
  host otherwise. **Credentials are origin-bound**: a passkey made on a tunnel URL
  won't be offered on `localhost` or `framedat.uk`.
- `user_verification=REQUIRED`, `resident_key=REQUIRED` — platform passkeys.
- Attestation is `none`; verification checks challenge, RP ID, origin, UV flag.
- Existing credentials go in `excludeCredentials` during registration.
- Failed challenges are `WebAuthnChallenge` rows — single-use, expiring.

### Recovery & admin

- Owners can remove another staff member's passkey (`DELETE
  /api/admin/staff/{id}/passkeys/{credential_id}`) — lost-device recovery.
- Staff can list/remove their own credentials under `/api/admin/passkeys`.
- Every new credential triggers an alert email to all active staff — a rogue
  enrolment is visible immediately.

## Scanner sessions

`POST /api/admin/events/{event_id}/scanner-links` mints a short-lived per-event link;
`POST /api/scanner/session` redeems it into a cookie scoped to that event's scans.

## Session lifecycle

- Sessions are rows — `DELETE /api/auth/sessions/current` revokes; admin "Log out
  everywhere" revokes all but current.
- Authenticated SSE streams revalidate the session each tick and close on revocation.
- QR tokens are signed (`build_ticket_token`) and tied to the ticket row.

## Threat notes

- **Origin binding** means `BASE_URL` must be final before launch — quick tunnels
  break passkeys each restart.
- In-app browsers (mail webviews) cannot run WebAuthn — the app detects this and
  tells the user to open the real browser.
- Rate-limit writes commit in a separate transaction so a failed request can't
  erase the hit record.
