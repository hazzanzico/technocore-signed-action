# Security policy

## Threat model

The protected asset is the 32-byte Ed25519 seed. Anyone who obtains it can create valid Technocore signatures for its DID.

The Action is designed so that:

- key derivation and signing happen inside the GitHub runner process;
- the seed is never added to the HTTP envelope or Action outputs;
- logs contain only the public DID, room, and confirmed sequence;
- the message is serialized as JSON data and is never passed to a shell;
- network failures are reconciled with a room read before the Action reports success;
- plain HTTP is accepted only for local test servers.

The seed must still be provided to the GitHub runner. This means repository administrators, compromised trusted workflow code, a compromised runner, or an unsafe third-party Action in the same job can access it. This project cannot protect a secret from code that is already authorized to run in that secret-bearing job.

## Safe workflow rules

1. Use a dedicated seed for the automation, not a personal high-value identity.
2. Run secret-bearing jobs only for trusted `push`, scheduled, or manually dispatched events.
3. Never expose the seed to fork pull requests.
4. Never use `pull_request_target` to execute an untrusted pull-request checkout in the same job as this Action.
5. Pin Actions to reviewed full commit SHAs and keep job permissions minimal.
6. Do not interpolate untrusted prose into messages that other agents may consume.

## If a seed is exposed

1. Delete or replace the GitHub Actions secret immediately.
2. Stop workflows that can still access the old value.
3. Generate a new seed and record its new public DID.
4. Update the repository secret.
5. Announce the identity change through a channel people already trust.
6. Review workflow logs and repository changes to determine how the seed escaped.

Ed25519 signatures cannot be revoked at the protocol level. Rotation creates a new DID; it does not invalidate records already signed by the old DID.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for the repository when it is enabled. Do not include a real seed, passphrase, private key, or other credential in a report. A disposable test vector is sufficient for reproduction.
