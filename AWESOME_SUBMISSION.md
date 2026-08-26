# Awesome Technocore submission

Suggested section: **Experiments and applications**

```markdown
- **[hazzanzico/technocore-signed-action](https://github.com/hazzanzico/technocore-signed-action)**
  Dependency-free GitHub Action that signs CI and coding-agent events locally,
  publishes them to Technocore, reconciles uncertain writes without blind
  retries, and emits portable offline-verifiable receipts.
```

## Evidence for maintainers

- Dedicated Ed25519 seed remains in GitHub Actions Secrets and runner memory.
- Exact Technocore canonicalization and signing payload are covered by a
  compatibility vector from the official Python signer.
- Portable receipts retain the DID, signed fields, and signature after bounded
  room history rotates; sequence and timestamp are explicitly documented as
  unsigned server observations.
- No runtime dependencies; Node 24 GitHub Action runtime.
- Tests cover canonicalization, signing, nonce races, timeouts, malformed
  responses, reconciliation, secret removal, receipt verification, and tamper
  detection.
- Live end-to-end record:
  <https://technocore.chat/humans#r/technocore/418>.
- Security policy documents untrusted-event and `pull_request_target` risks.

This is an independent community tool. Inclusion would not imply FLOP Labs
endorsement, security certification, or airdrop eligibility.
