// SPDX-License-Identifier: Apache-2.0
//
// Live broadcast on qorechain-diana through the mock, no stubs. Skipped
// unless QORE_LIVE_TEST=1 and QORE_TEST_MNEMONIC (a funded testnet account
// whose ML-DSA-87 key is registered, or will be on its first send).

import { qorexMockFixtures } from "@qorechain/qorex-synpress";
import { expect, out, run } from "./helpers";

const LIVE = process.env.QORE_LIVE_TEST === "1" && !!process.env.QORE_TEST_MNEMONIC;

const test = qorexMockFixtures({
  profile: "current",
  chainId: "qorechain-diana",
  ...(LIVE ? { mnemonic: process.env.QORE_TEST_MNEMONIC } : {}),
  inclusionTimeoutMs: 60_000,
});

test.skip(!LIVE, "set QORE_LIVE_TEST=1 and QORE_TEST_MNEMONIC to broadcast on qorechain-diana");

test("hybrid 1 uqor self-send on qorechain-diana", async ({ page, qorex }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await run(page, "cosmos-get-key");
  await expect(out(page, "cosmos-get-key")).toContainText(qorex.addresses.native);
  await run(page, "cosmos-send", "ok", 150_000);
  await expect(out(page, "cosmos-send")).toContainText('"code": 0');
  await expect(out(page, "cosmos-layer")).toHaveText("hybrid ML-DSA-87 layer present in the committed transaction", {
    timeout: 60_000,
  });
});
