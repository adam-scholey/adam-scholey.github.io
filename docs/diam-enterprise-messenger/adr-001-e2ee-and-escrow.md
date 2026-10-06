# ADR-001: Client-Side End-to-End Encryption with Enterprise Escrow

## Status

Accepted

## Date

2026-06-09

## Context

diam Enterprise Messenger stores sensitive business communications. The product must:

- Keep message content confidential from the server operator.
- Allow employees to chat across browsers and devices without losing history.
- Enable the organisation owner/admin to recover an employee's chat history if required by policy or legal need.
- Avoid custom cryptography and rely on well-audited primitives.

The Web Crypto API is available in all modern browsers and provides RSA-OAEP, AES-GCM, and PBKDF2.

## Decision

Implement client-side end-to-end encryption with the following design:

1. Each user has an RSA-OAEP 2048-bit key pair generated in the browser.
2. Messages are encrypted with a per-message AES-GCM 256-bit key.
3. The AES key is wrapped with the recipient's RSA public key and the sender's own RSA public key.
4. Private keys are encrypted with a password-derived AES key (PBKDF2-SHA-256, 100,000 iterations, 16-byte salt) and uploaded to the server as an opaque backup.
5. A multi-key archive (`user_key_history`) preserves old private keys so messages encrypted for previous keys remain readable.
6. The organisation has a master RSA key pair. Each user backup is optionally wrapped with the organisation public key, enabling owner/admin escrow recovery. The server stores the escrow-wrapped backup but cannot decrypt it without the organisation private key, which only the owner/admin holds.
7. The server validates only the shape of encrypted payloads and stores opaque JSON blobs.

## Alternatives Considered

### Signal Protocol / Double Ratchet

- **Pros**: Provides forward secrecy and deniability; industry standard for consumer messaging.
- **Cons**: Significantly more complex; multi-device and group key management require careful design; no out-of-the-box Web Crypto implementation.
- **Rejected for v0.1**: Too complex for the current delivery horizon. MLS or Signal Protocol should be evaluated for a future version.

### Server-side encryption at rest

- **Pros**: Simple to implement and operate.
- **Cons**: The server can read messages, which violates the confidentiality requirement for E2EE.
- **Rejected**: Does not meet the security goals.

### Per-device keys only

- **Pros**: Cleaner device trust model.
- **Cons**: Cross-device history recovery is harder; employees frequently switch between laptop and browser.
- **Rejected**: The product explicitly requires cross-browser history without repeated password prompts when possible.

## Consequences

- Direct messages are encrypted before leaving the browser. The server cannot read DM content.
- Users can recover history on a new device by decrypting server-held key backups with their password.
- Organisation owners/admins can recover employee backups only by decrypting the escrow copy with the organisation private key.
- The design does **not** provide forward secrecy. If a private key is compromised, all messages encrypted for that key are exposed.
- Channel and group E2EE remain incomplete because distributing shared channel keys to members is not yet implemented.
- `localStorage` is currently used for key persistence, which is less secure than hardware-backed or non-exportable storage.

## Related Files

- `web/crypto.js`
- `server/users.py`
- `server/organisations.py`
- `server/crypto.py`
- `server/database.py`
