# framed@ — API Overview

## Auth

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/magic-link` | Send a magic link + 6-digit code via Resend |
| `POST /api/auth/verify` | Redeem a token or code — single-use, 5-minute TTL, rate-limited per email and IP |

## Ticketing

| Endpoint | Purpose |
| --- | --- |
| `POST /api/checkout-sessions` | Create a Stripe hosted checkout session |
| `POST /api/stripe/webhook` | Signed webhook — idempotent order fulfilment and refunds |
| `GET /api/my-tickets` | Customer dashboard — QR-code tickets |

## Door scanning

| Endpoint | Purpose |
| --- | --- |
| `GET /scanner/{event}/{token}` | Per-event scanner link — jsQR/ZXing in-browser decode |
| `POST /api/scanner/admit` | Conditional UPDATE — one admission even under concurrent scans |

## Admin

| Endpoint | Purpose |
| --- | --- |
| `/api/admin/...` | Event, tier and order CRUD plus live metrics over SSE |
| `POST /api/archive/upload` | Presigned R2 upload for video and image derivatives |

## Analytics

| Endpoint | Purpose |
| --- | --- |
| `POST /api/beacon` | Cookie-free page-view beacon — 30-day retention with daily rollup |
