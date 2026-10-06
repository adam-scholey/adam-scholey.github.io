# ADR-003: Channel Key Versioning and Re-Keying on Member Removal

## Status

Accepted

## Date

2026-09-11

## Context

Channels were originally encrypted with a single AES-GCM key wrapped per member
and stored in `channel_members.encrypted_channel_key`. When a member was
removed they kept that key material, so they could decrypt *future* messages
forever - the biggest E2EE gap in the product.

## Decision

Introduce channel key **epochs**:

1. `channels.key_version` is the current epoch; `channels.rekey_required`
   flags channels that must be rotated.
2. `channel_member_keys (channel_id, user_id, version, wrapped_key)` stores
   every wrapped key a member has ever held. Inserts are fill-once
   (`INSERT OR IGNORE`) - a version slot can never be overwritten, preserving
   the key-substitution defence.
3. `channel_key_history (channel_id, version, org_wrapped_key)` stores the
   org-escrow copy of every epoch so admins can recover any history.
4. `messages.key_version` records which epoch encrypted the message; clients
   pick the matching key version when decrypting.
5. Removing a member sets `rekey_required`. The removing client (or the next
   privileged member to open the channel) calls
   `POST /api/channels/{id}/rekey` (creator/admin only) with a fresh AES key
   wrapped for *remaining* members + the org escrow key. The server bumps the
   epoch atomically and emits `channel_rekeyed`.
6. Lazy key distribution now wraps **all** versions a member is missing, so
   late joiners and recovered members can still read pre-rotation history.
7. Users removed from the organisation flag their channels for re-keying;
   the next member with the key rotates opportunistically on open.

## Consequences

- Removed members cannot decrypt messages written after the rotation.
- Old messages remain decryptable for retained members (no forward secrecy
  loss relative to before - that requires a real ratchet, still out of scope).
- A member missing a version is backfilled by any member who holds it.
- Server still sees only opaque wrapped blobs; rotation is client-driven.

## Related Files

- `server/channels.py` - `_record_key_version`, `distribute_channel_keys`, `rekey_channel`
- `server/database.py` - `channel_member_keys`, `channel_key_history`, `messages.key_version`
- `web/crypto.js` - versioned `channelKeys` map (channel_id → version → key)
- `web/app.js` - `ensureChannelKey`, `rekeyChannel`, version-aware decrypt
