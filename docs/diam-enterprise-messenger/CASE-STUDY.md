# diam Enterprise Messenger - Case Study

## Why it's built this way

Enterprise chat tools usually trust the server completely - Slack, Teams, and
most self-hosted options can read everything they store. I wanted to see what
"secure" actually means when you remove that assumption, so diam is designed
around a hostile-server model: the backend stores and routes ciphertext, and
the interesting engineering is everything you have to reinvent when the server
can't see plaintext.

The second goal was real multi-tenancy. Most apps scope queries with a WHERE
clause and hope nothing forgets it. diam pushes tenant isolation into
PostgreSQL Row-Level Security with `FORCE ROW LEVEL SECURITY`, so even a
misconfigured query - or a compromised application layer - still can't read
another organisation's rows. The application runs as a restricted, non-owner
role for exactly this reason: RLS is silently a no-op for superusers, which is
a trap I fell into during testing before forcing the app onto its own role.

## Problems solved

**Key rotation on member removal.** The hardest E2EE problem: when someone
leaves a channel they keep every key they ever had, but they mustn't get new
ones. I implemented key epochs - each channel key version is wrapped per
member, messages carry the epoch they were written under, and removal marks
the channel for re-key. History stays decryptable for everyone entitled; new
messages aren't readable by the departed member. The rotation is client-driven,
so plaintext keys never touch the server.

**Search under encryption.** You can't grep ciphertext. The honest answer is a
split search: the server indexes only what it's allowed to see (channel names,
people, file metadata) and message bodies are searched client-side over
locally decrypted content. No fake "encrypted search" claims.

**Mentions without leaking content.** @mention notifications need the server
to know *who* was mentioned, but not *what* was said. Mention target IDs travel
as routing metadata outside the encrypted envelope; the body stays encrypted.

**Enterprise key escrow.** Organisations need recovery when someone loses a
device or leaves on bad terms. Each member's key backups and every channel key
epoch are wrapped with an organisation public key; the matching private key is
unlockable only by an owner/admin password, client-side. The server stores the
ciphertext and writes an audit event - it can never decrypt on its own.

**Session security without JWTs.** Opaque server-side sessions (revocable
instantly on logout, reset, or removal), bound to IP and User-Agent, with a
per-session CSRF token on top of SameSite cookies and Origin checks. TOTP
MFA with encrypted-at-rest secrets and single-use backup codes.

**Making the security actually verifiable.** A full `/secure` audit pass -
Semgrep, GitLeaks, pip-audit, Trivy, and an OWASP ZAP baseline - plus an
integration test that proves RLS works at the raw-SQL level, not just through
the API. The audit caught a real IDOR (sequential file IDs let any org member
fetch staged uploads) and the fact that the dockerised Postgres role silently
bypassed every policy I'd written. CI now runs the whole thing on every push,
including a live Postgres service for the RLS tests.

## What I was responsible for

Everything - this is a solo build. Specifically:

- Designed and implemented the E2EE model end to end: RSA-OAEP key wrapping,
  AES-GCM for messages and files, PBKDF2 password-derived recovery, and
  non-extractable key storage in IndexedDB via the Web Crypto API.
- Wrote the channel key-epoch system and the client + server re-keying flow.
- Built the auth stack: Argon2id hashing, session binding, login lockout,
  TOTP enrolment and backup codes, per-session CSRF.
- Wrote the Postgres schema, all RLS policies, the restricted-role
  provisioning script, and the integration tests that prove isolation.
- Designed the compliance surface: retention policies, gated purge,
  org export, and the audit log.
- Built the entire frontend in vanilla JS - no framework - including
  encrypted message rendering, mention autocomplete, file warnings, and the
  admin recovery console.
- Ran the security audit, triaged every finding, fixed them, and wired the
  scanners into CI so they run per-commit.
