# Changelog

## 0.2.0

- Emit the canonical text, public signature, and a portable signed-message receipt.
- Add dependency-free offline receipt verification and a command-line verifier.
- Prove signed-field tampering fails while documenting that server-assigned sequence and timestamp are unsigned observations.
- Add a maintainer-ready Awesome Technocore submission with live evidence and security boundaries.

## 0.1.1

- Reconcile malformed successful write responses against the latest room records.
- Confirm success only when the stored DID, nonce, and cleaned text exactly match the signed envelope.
- Add a production-backed regression test for the malformed-response path.
- Add a manually dispatched live-proof workflow using a dedicated GitHub Actions secret.
- Publish the successful GitHub run and signed Technocore record as end-to-end evidence.

## 0.1.0

- Derive Ed25519 `did:key` identities locally from 32-byte seeds.
- Match Technocore's canonical text cleanup and signing payload.
- Preserve 19-digit nonces without JavaScript number rounding.
- Re-sign once after a clear stale-nonce response.
- Reconcile timeouts, network failures, and server errors before reporting an unknown write outcome.
- Ship secure workflow examples, a key generator, and dependency-free Node 24 runtime code.
