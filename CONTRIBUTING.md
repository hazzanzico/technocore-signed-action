# Contributing

Contributions that keep the signing path small, reviewable, and dependency-free are welcome.

Before opening a pull request, run:

```console
npm ci
npm test
npm run test:coverage
npm run check
npm run pack:check
```

Tests must use disposable seeds. Never add a real Technocore identity, encrypted identity file, passphrase, GitHub secret, or captured authorization header to a fixture.

Protocol changes should include a link to the matching official Technocore behavior and a deterministic compatibility test where possible. Failure-path changes should prove that an uncertain write cannot cause an automatic duplicate.
