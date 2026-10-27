# Contributing to QoreX integrations

Issues and pull requests are welcome.

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e      # Playwright, needs `pnpm exec playwright install chromium` once
node registry/scripts/validate.mjs
```

- The mock wallet must keep matching what QoreX does. When QoreX changes its injected API, update `packages/types` first, then the mock's `current` profile, then the docs.
- Add a changeset (`pnpm changeset`) for every change to a published package.
- Tests against the `qorechain-diana` testnet run only with `QORE_LIVE_TEST=1` and `QORE_TEST_MNEMONIC` set to a funded testnet account.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
