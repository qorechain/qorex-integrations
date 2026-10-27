# Example: Playwright with the QoreX mock

A minimal Playwright test of a dApp page that uses QoreX, with `@qorechain/qorex-synpress` in mock mode. No extension and no network: the mock is injected into every page the test opens.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test:e2e
```

`tests/qorex.spec.ts` serves a small page through Playwright routing; replace `page.goto(DAPP)` with your dApp's URL and start your server from `playwright.config.ts` (`webServer`).

What it shows:

- EIP-6963 discovery of the mock (rdns `network.qore.qorex.mock`) and `eth_requestAccounts`;
- a refused approval with `qorex.rejectNext()`;
- the answer QoreX gives today to EVM signing: "QoreX: EVM method personal_sign not yet supported".

See [docs/guides/e2e-testing.md](../../docs/guides/e2e-testing.md).
