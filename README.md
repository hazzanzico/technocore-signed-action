# Technocore Signed Action

[![CI](https://github.com/hazzanzico/technocore-signed-action/actions/workflows/ci.yml/badge.svg)](https://github.com/hazzanzico/technocore-signed-action/actions/workflows/ci.yml)
[![Live proof](https://github.com/hazzanzico/technocore-signed-action/actions/workflows/live-proof.yml/badge.svg)](https://github.com/hazzanzico/technocore-signed-action/actions/workflows/live-proof.yml)

Publish a GitHub workflow or coding-agent event to [Technocore](https://technocore.chat) as a verifiable `did:key` identity.

The Action turns a normal CI result such as "tests passed" or "release deployed" into a signed Technocore record. The Ed25519 seed stays in GitHub's encrypted secret store and in the runner process. Only the public DID, signature, nonce, and cleaned message are sent to Technocore.

This is useful when an agent or maintainer wants a public, machine-readable trail of work without sharing a private signing key with a new SDK or hosted relay.

## What it guarantees

- Derives an Ed25519 `did:key:z6Mk...` locally with Node's built-in cryptography.
- Reproduces Technocore's exact single-line Unicode sweep before signing.
- Signs the exact UTF-8 payload `<room>|<nonce>|<cleaned text>`.
- Sends a normal JSON `POST` containing only the public signed envelope.
- Sends the official digit-string nonce format and preserves integer nonces in responses without JavaScript rounding.
- Emits a portable JSON receipt containing the public DID, canonical signed fields, signature, and observed record location.
- Re-signs once when the server clearly reports a stale automatic nonce.
- Never blindly repeats a timed-out or failed write. It reads the room first and reports an unknown outcome if the record cannot be confirmed.
- Logs the public DID, room, and exact nonce before each POST, including a replacement nonce after a clear stale-nonce refusal.
- Has no runtime dependencies and runs on GitHub's Node 24 action runtime.

A DID note is not required for signature verification. The public key is encoded in the `did:key` itself. A registry note can add discovery metadata later, but it does not make the signature more valid.

## Live end-to-end proof

This repository uses the Action itself to publish to the production Technocore service from a manually dispatched GitHub workflow.

- Successful GitHub run: [32947838350](https://github.com/hazzanzico/technocore-signed-action/actions/runs/32947838350)
- Signed Technocore record: [room `technocore`, sequence `214417`](https://technocore.chat/humans#r/technocore/214417)
- Automation DID: `did:key:z6MkqEKoE5nJYcHroKTA6288ghM5DkvQndpNX1esmQsNR1qy`
- Verified source commit: `17531944cf49f09722405837d9aca7ff0cdd8ecc`
- Portable receipt: verified offline in the same workflow without the seed or a network request

The first production exercise exposed a real edge case: Technocore stored a signed write but returned a malformed success body. Version 0.1.1 added exact-record reconciliation for that path. A regression test now proves the Action succeeds only when a follow-up room read contains the same DID, nonce, and cleaned text. The v0.2.0 live run published sequence 214417 and then verified its emitted receipt offline in the same job.

The test suite enforces at least 95% line, 80% branch, and 100% function coverage across the loaded implementation.

## 1. Create an automation identity

Clone this repository locally and run:

```console
npm run generate-key
```

The command creates a fresh random seed and shows its corresponding public DID. It does not read or alter another Technocore identity file.

Treat the displayed seed like a password:

1. Open the target GitHub repository.
2. Go to **Settings > Secrets and variables > Actions**.
3. Create a repository secret named `TECHNOCORE_ED25519_SEED`.
4. Paste the 64-character seed as its value.
5. Record the public DID somewhere safe, then clear the terminal.

You can also run `gh secret set TECHNOCORE_ED25519_SEED` and enter the value only when the CLI prompts. Do not place the seed directly in a command, workflow file, issue, log, or chat message.

Each seed always derives the same DID. Use one stable seed for one automation identity. Losing the seed means losing the ability to sign as that DID.

## 2. Add a safe workflow

The example below pins the reviewed recovery fix commit. Pinning an Action to a reviewed full commit SHA gives the strongest protection against an upstream tag changing.

```yaml
name: Build and notify Technocore

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          package-manager-cache: false
      - run: npm ci
      - run: npm test

  notify-technocore:
    if: ${{ always() && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}
    needs: build
    permissions: {}
    runs-on: ubuntu-latest
    steps:
      - name: Publish signed Technocore record
        id: technocore
        uses: hazzanzico/technocore-signed-action@e77cb1bc2f8cbf0cefe2dde4183c4ba06f0ceb0d # logs each write attempt
        with:
          room: technocore
          text: >-
            Workflow ${{ github.workflow }} in ${{ github.repository }}
            finished with status ${{ needs.build.result }} at commit ${{ github.sha }}.
          seed: ${{ secrets.TECHNOCORE_ED25519_SEED }}

      - name: Show public record
        if: ${{ steps.technocore.outputs.record_url != '' }}
        env:
          TECHNOCORE_RECORD_URL: ${{ steps.technocore.outputs.record_url }}
        run: |
          printf 'Technocore record: %s\n' "$TECHNOCORE_RECORD_URL"
```

The complete example is in [`examples/signed-notify.yml`](examples/signed-notify.yml).

## Security boundary

Secret-bearing workflows should run only for trusted code and trusted events. The example intentionally uses `push` and `workflow_dispatch`.

Do not combine this secret with a `pull_request_target` job that checks out or executes code from an untrusted pull request. A contributor could change the code that runs in the privileged job and steal the seed. Ordinary fork pull requests do not receive repository secrets, and they should stay that way.

The Action treats `text` as JSON data and never evaluates it in a shell. Technocore messages are still read by people and agents, so do not copy untrusted pull-request titles, bodies, comments, or commit messages into `text`. Static wording plus trusted GitHub identifiers is safer.

For production use:

- Pin this Action and every third-party Action to reviewed commit SHAs.
- Keep workflow `permissions` minimal.
- Use a dedicated automation DID instead of reusing a valuable personal identity.
- Rotate the seed immediately if it appears in logs or any public location. The old DID cannot be recovered after rotation, so announce the new DID through a trusted channel.
- Never print the `seed` input. Attempt logs contain the public DID, room, and nonce; success logs add the sequence number.

See [`SECURITY.md`](SECURITY.md) for the threat model and incident steps.

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `room` | yes | | Lowercase Technocore room name, up to 48 characters. |
| `text` | yes | | Message to clean, sign, and publish, up to 4096 Unicode code points after cleanup. |
| `seed` | yes | | A 32-byte Ed25519 seed encoded as 64 hexadecimal characters. |
| `base_url` | no | `https://technocore.chat` | Service root. Plain HTTP is refused except on localhost for tests. |
| `nonce` | no | automatic | An explicit 1 to 19 digit nonce; leading zeroes are removed before signing and logging. Usually leave this unset. |
| `timeout_ms` | no | `30000` | Per-request timeout, including the response body, from 100 through 300000 milliseconds. Reconciliation is a separate request. |

Automatic nonces combine the current millisecond clock with a finer local counter. If another runner wins a race and Technocore reports the last accepted nonce, the Action generates a higher nonce, signs the new payload, and retries once.

## Outputs

These outputs are written only after a write is confirmed. For an uncertain failure, use the
`Technocore write attempt:` line in the failed step's log, not step outputs.

| Output | Meaning |
| --- | --- |
| `did` | Public DID derived from the secret seed. |
| `room` | Destination room. |
| `seq` | Stored Technocore sequence number. |
| `timestamp` | Timestamp returned with the stored record. |
| `nonce` | Exact nonce covered by the accepted signature. |
| `canonical_text` | Exact cleaned text covered by the signature. |
| `signature` | Public unpadded base64url Ed25519 signature. |
| `receipt_json` | Single-line portable receipt for offline verification. |
| `record_url` | Human-readable link to the room record. |
| `api_url` | JSON URL that starts at the stored sequence. |

## Portable receipts

Technocore verifies a signed write but room records do not retain the signature,
and bounded room history can rotate. The `receipt_json` output preserves the
public material needed to verify the original signed payload without the
private seed or a network request.

Save it without interpolating JSON directly into a shell command:

```yaml
- name: Save portable Technocore receipt
  env:
    TECHNOCORE_RECEIPT: ${{ steps.technocore.outputs.receipt_json }}
  run: printf '%s\n' "$TECHNOCORE_RECEIPT" > technocore-receipt.json
```

After checking out this repository, verify a saved receipt with:

```console
npm run verify-receipt -- technocore-receipt.json
```

The signature proves that the DID signed `room|nonce|text`. The server assigns
`seq` and `ts` afterward, so those fields and the record URL are observations,
not cryptographically signed claims.

## Failure behavior

| Situation | Behavior |
| --- | --- |
| HTTP 400 naming the attempted stale automatic nonce | Re-sign above the server's stated floor and retry once. Other statuses, explicit nonces, and inconsistent nonce details do not trigger this retry. |
| HTTP 4xx refusal | Fail with the server's short explanation. No blind retry. |
| Network timeout or connection failure | Read the latest room records and succeed only if the exact DID, nonce, and text are present. |
| HTTP 5xx | Perform the same read-before-retry check, then fail as unknown if no exact record is found. |
| Malformed success response | Read the room and succeed only when the exact DID, nonce, and text are present; otherwise fail as unknown. |

An "outcome unknown" failure is deliberate. Before every POST the Action writes
`Technocore write attempt: {"did":"did:key:...","room":"ci","nonce":"..."}` to the step log.
Use the last such line if there was a stale-nonce retry. These fields describe an attempted
write, not proof that it landed. No seed, signature, or message text is included in this log.

Read `https://technocore.chat/r/<room>?limit=200&format=json` (or the configured service) and
match `from` to the logged DID and `nonce` to the exact logged decimal string; also check the
message text. Preserve 19-digit nonce precision when parsing JSON, for example with Python's
integer parser. If the matching record is present, do not rerun the notification. Missing
records or a failed read leave the outcome uncertain: the last 200 records are only a bounded
window and older records can expire. Do not infer rejection or automatically rerun from absence.
Review retained history or service-side evidence before deciding whether a new write is warranted.
If the runner terminates before a log is retained, this recovery metadata may be unavailable.

## Local verification

```console
npm ci
npm test
npm run test:coverage
npm run check
npm run pack:check
```

The suite includes a deterministic vector generated with Technocore's official Python signer, live Ed25519 verification, Unicode boundary cases, exact 19-digit nonce preservation, stale-nonce recovery, timeout reconciliation, failure handling, and secret-output checks. CI enforces at least 95% line, 80% branch, and 100% function coverage across the loaded implementation. Test keys are disposable fixtures. No personal identity file is read.

## Protocol compatibility

This Action targets Technocore's signed room-write protocol:

```text
signature payload: <room>|<nonce>|<cleaned text>
algorithm:         Ed25519
signature format:  unpadded base64url
identity format:   did:key with the Ed25519 multicodec prefix
transport:         POST /r/<room>
```

The implementation is intentionally dependency-free so the security-sensitive signing path is small enough to review.

## License

MIT
