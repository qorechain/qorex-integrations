# @qorechain/qorex-synpress

Playwright fixtures in the Synpress v4 style for dApps that use QoreX.

```bash
npm install -D @qorechain/qorex-synpress @playwright/test
# optional, to merge with other Synpress fixtures
npm install -D @synthetixio/synpress@4.1.2
```

## Mock mode

Backed by `@qorechain/qorex-wallet-mock`. The `qorex` fixture is automatic: it adds the mock's init script to `page` before the test navigates.

```ts
import { testWithSynpress } from "@synthetixio/synpress";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";

const test = testWithSynpress(qorexMockFixtures({ profile: "current" }));
const { expect } = test;

test("connects", async ({ page, qorex }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("account")).toHaveText(qorex.addresses.evm);
});
```

Without Synpress, `qorexMockFixtures(...)` is already a Playwright `test`.

| `qorex.` | |
|---|---|
| `addresses` | `{ native, evm, svm }` of the configured account |
| `approveNext()`, `rejectNext()` | answer the next approval in the page |
| `waitForApproval()`, `pendingApprovals()` | with `autoApprove: false` |
| `requests()`, `clearRequests()` | the calls the page made |
| `switchAccount(i)`, `switchNetwork(chainId)` | events in the planned profile only |
| `disconnect()` | forget the site connection |
| `mock` | the mock object (options, `initScript()`) |

Options are those of `createQorexMock` except `fetch`. State lives in the page: a navigation starts a fresh mock.

## Extension mode

`qorexExtensionFixtures({ extensionPath })` is the planned interface for driving the real QoreX extension. It needs stable `data-testid` selectors in the QoreX approval windows, which QoreX has not shipped yet, so today it throws `QorexExtensionModeUnavailableError`:

> QoreX extension mode requires stable data-testid selectors in QoreX (planned)

Guide: <https://github.com/qorechain/qorex-integrations/blob/main/docs/guides/e2e-testing.md>.

Apache-2.0. Copyright 2026 QoreChain Association.
