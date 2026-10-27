# End-to-end testing with QoreX

Test a dApp that uses QoreX without the extension, in Playwright or in jsdom, with `@qorechain/qorex-wallet-mock` and `@qorechain/qorex-synpress`.

| Mode | What runs | Status |
|---|---|---|
| Mock | a test double injected into the page: same objects as QoreX, real signatures | available |
| Extension | the real QoreX extension in Chromium | planned: needs stable `data-testid` selectors in QoreX |

## The mock

The mock injects `window.qorex = { evm, native, svm }`, announces EIP-6963 as **QoreX (mock)** with rdns `network.qore.qorex.mock` and registers a Solana Wallet Standard wallet. Signing is real:

- QoreChain native lane: hybrid secp256k1 + ML-DSA-87 (FIPS 204) through QoreSign, broadcast to the REST endpoint you configure (default `https://api-testnet.qore.host`);
- EVM: secp256k1 (EIP-191, EIP-712) in the planned profile;
- Solana: ed25519.

Accounts are derived from the public BIP-39 test mnemonic unless you pass one, with the same paths as QoreX. Signing for `qorechain-vladi` (mainnet) is refused unless `allowMainnet: true`.

### Profiles

- `current` (default): what QoreX does today, with the same error messages. Use it to make sure your dApp handles QoreX as it ships: EVM signing answers "QoreX: EVM method personal_sign not yet supported" with no code, no `accountsChanged`, `signDirect` needs the hybrid layer already in the body, `signArbitrary` is refused.
- `planned`: adds what QoreX has announced: `accountsChanged` / `chainChanged`, EIP-1193 code 4200 on unanswered methods and 4902 on unknown chains (same text), `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`, `wallet_addEthereumChain`, `signDirect` adding the hybrid layer itself, `getOfflineSigner`, `signArbitrary` (message-signing-v1). Use it to build ahead.

Run your suite in both to cover today's QoreX and the next one.

## Playwright

```bash
npm install -D @playwright/test @qorechain/qorex-synpress
npx playwright install chromium
```

```ts
import { expect } from "@playwright/test";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";

const test = qorexMockFixtures({ profile: "current" });

test("connect, then a refused signature", async ({ page, qorex }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("account")).toHaveText(qorex.addresses.evm);

  await qorex.rejectNext();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("QoreX: signature rejected");
});
```

The `qorex` fixture is automatic: it adds the mock's init script before the test navigates, so every page has the wallet. Its state lives in the page; a navigation starts a fresh mock.

### With Synpress v4

`qorexMockFixtures` returns a Playwright `test`, so it merges like any Synpress fixture:

```ts
import { testWithSynpress } from "@synthetixio/synpress";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";

const test = testWithSynpress(qorexMockFixtures({ profile: "planned" }));
```

### Approvals

With the default `autoApprove: true` every approval is granted unless `qorex.rejectNext()` was called first. To look at the page while the wallet waits:

```ts
const test = qorexMockFixtures({ autoApprove: false });

test("shows a pending state", async ({ page, qorex }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click();
  await qorex.waitForApproval();
  await expect(page.getByText("Waiting for QoreX")).toBeVisible();
  await qorex.approveNext();
});
```

The site connection is shared by the three lanes, as in QoreX: the first `eth_requestAccounts`, `enable`, `getKey` or Solana `connect` asks for it, and later calls do not.

### What the page asked

`await qorex.requests()` returns every call: method (`evm:personal_sign`, `native:signAndBroadcast`, `svm:signMessage`, ...), parameters as JSON, how the approval was answered and the result or error.

### Account and network changes

`qorex.switchAccount(1)` and `qorex.switchNetwork("qorechain-vladi")` change the selection. In the planned profile the EVM provider emits `accountsChanged` / `chainChanged`; in the current profile nothing is emitted, as with QoreX today, so this is how you test your focus-polling fallback.

## Transactions without the network

`signAndBroadcast` talks to the REST endpoint. For a deterministic suite, answer those calls with Playwright routing and check what the mock sent. The demo app does this in [apps/demo/e2e/chain-stub.ts](../../apps/demo/e2e/chain-stub.ts). The endpoints the mock uses:

| Request | Used for |
|---|---|
| `GET /cosmos/auth/v1beta1/account_info/{address}` | account number and sequence |
| `GET /qorechain/pqc/v1/account/{address}` | the registered ML-DSA-87 key (`found: false` makes the mock register it first) |
| `GET /cosmos/upgrade/v1beta1/applied_plan/{name}` | which hybrid sign-bytes version the network verifies |
| `POST /cosmos/tx/v1beta1/txs` | broadcast |
| `GET /cosmos/tx/v1beta1/txs/{hash}` | inclusion and the committed extension options (the hybrid layer) |

Verify a captured transaction with QoreSign:

```ts
import { verifyHybridTx } from "@qorechain/qoresign";

const { valid } = verifyHybridTx({ txBytes, chainId: "qorechain-diana", accountNumber, classicalPublicKey, pqPublicKey });
```

## Live tests on the testnet

Without routing, the mock broadcasts for real. Keep such tests opt-in and point them at a funded testnet account of your own; the public test mnemonic is known to everyone.

```ts
const LIVE = process.env.QORE_LIVE_TEST === "1" && !!process.env.QORE_TEST_MNEMONIC;
const test = qorexMockFixtures({ mnemonic: process.env.QORE_TEST_MNEMONIC, inclusionTimeoutMs: 60_000 });
test.skip(!LIVE, "live test");
```

## jsdom and Vitest

```ts
import { createQorexMock } from "@qorechain/qorex-wallet-mock";

const mock = createQorexMock({ profile: "planned", fetch: myRestStub });
mock.install(window);

const [account] = await window.qorex!.evm.request({ method: "eth_requestAccounts" });
mock.rejectNext();
```

`fetch` replaces the network for REST and EVM JSON-RPC calls.

## Extension mode

`qorexExtensionFixtures({ extensionPath })` is the interface for driving the real extension. Until QoreX ships stable `data-testid` selectors in its approval windows it throws:

> QoreX extension mode requires stable data-testid selectors in QoreX (planned)

## CI

```yaml
- run: pnpm exec playwright install --with-deps chromium
- run: pnpm exec playwright test
```

Cache `~/.cache/ms-playwright` keyed by the Playwright version. This repository's [e2e workflow](../../.github/workflows/e2e.yml) is a working example.

## Examples

- [examples/playwright-e2e](../../examples/playwright-e2e): the smallest setup.
- [apps/demo](../../apps/demo): every QoreX path, tested in both profiles.
