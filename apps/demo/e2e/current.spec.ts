// SPDX-License-Identifier: Apache-2.0
//
// The demo against the mock in the "current" profile: what QoreX does today.
// Uses Synpress v4's testWithSynpress to show the fixture merges with it.

import { ed25519 } from "@noble/curves/ed25519.js";
import { PUBLIC_TEST_MNEMONIC } from "@qorechain/qorex-wallet-mock";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";
import { verifyHybridTx } from "@qorechain/qoresign";
import { testWithSynpress } from "@synthetixio/synpress";
import { base58 } from "@scure/base";
import { ACCOUNT_NUMBER, stubChain } from "./chain-stub";
import { expect, out, run } from "./helpers";

const test = testWithSynpress(qorexMockFixtures({ profile: "current", pollIntervalMs: 100 }));

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("discovers the mock through EIP-6963", async ({ page }) => {
  await run(page, "evm-discover");
  await expect(out(page, "evm-discover")).toHaveText("QoreX (mock) (network.qore.qorex.mock)");
});

test("EVM: connect, chain id and switching", async ({ page, qorex }) => {
  await run(page, "evm-discover");
  await run(page, "evm-connect");
  await expect(out(page, "evm-connect")).toContainText(qorex.addresses.evm);
  await run(page, "evm-chain-id");
  await expect(out(page, "evm-chain-id")).toHaveText("0x2648");
  await run(page, "evm-switch");
  await expect(out(page, "evm-switch")).toHaveText("null");
  await run(page, "evm-switch-other", "error");
  await expect(out(page, "evm-switch-other")).toContainText('"code": 4902');
});

test("EVM signing answers 'not yet supported' with no code", async ({ page }) => {
  await run(page, "evm-discover");
  await run(page, "evm-connect");
  await run(page, "evm-personal-sign", "error");
  await expect(out(page, "evm-personal-sign")).toHaveText(
    JSON.stringify({ message: "QoreX: EVM method personal_sign not yet supported" }, null, 2),
  );
  await run(page, "evm-typed-data", "error");
  await expect(out(page, "evm-typed-data")).toHaveText(
    JSON.stringify({ message: "QoreX: EVM method eth_signTypedData_v4 not yet supported" }, null, 2),
  );
});

test("EVM: no events when the account changes", async ({ page, qorex }) => {
  await run(page, "evm-discover");
  await run(page, "evm-connect");
  await qorex.switchAccount(1);
  await page.waitForTimeout(200);
  await expect(out(page, "evm-events")).toHaveText("none received");
});

test("a rejected connection is reported", async ({ page, qorex }) => {
  await run(page, "evm-discover");
  await qorex.rejectNext();
  await run(page, "evm-connect", "error");
  await expect(out(page, "evm-connect")).toContainText("QoreX: connection rejected");
  const log = await qorex.requests();
  expect(log.at(-1)).toMatchObject({ method: "evm:eth_requestAccounts", approval: "rejected", outcome: "error" });
});

test("QoreChain: getKey and a hybrid 1 uqor self-send", async ({ page, qorex }) => {
  const chain = await stubChain(page, PUBLIC_TEST_MNEMONIC);
  await run(page, "cosmos-get-key");
  await expect(out(page, "cosmos-get-key")).toContainText(qorex.addresses.native);
  await run(page, "cosmos-send");
  await expect(out(page, "cosmos-send")).toContainText('"shield": "shielded"');
  await expect(out(page, "cosmos-layer")).toHaveText("hybrid ML-DSA-87 layer present in the committed transaction");
  expect(chain.txs).toHaveLength(1);
  const tx = chain.txs[0]!;
  await expect(out(page, "cosmos-send")).toContainText(tx.hash);
  const check = verifyHybridTx({
    txBytes: tx.txBytes,
    chainId: "qorechain-diana",
    accountNumber: ACCOUNT_NUMBER,
    classicalPublicKey: chain.classicalPublicKey,
    pqPublicKey: chain.pqPublicKey,
  });
  expect(check.valid).toBe(true);
});

test("QoreChain: signArbitrary is refused today", async ({ page }) => {
  await run(page, "cosmos-get-key");
  await run(page, "cosmos-sign-arbitrary", "error");
  await expect(out(page, "cosmos-sign-arbitrary")).toContainText("QoreX: signArbitrary not yet supported");
});

test("Solana: connect and signMessage", async ({ page, qorex }) => {
  await run(page, "sol-connect");
  await expect(out(page, "sol-connect")).toContainText(qorex.addresses.svm);
  await run(page, "sol-sign-message");
  const { signature } = JSON.parse((await out(page, "sol-sign-message").textContent()) ?? "{}") as { signature: string };
  const message = new TextEncoder().encode("Hello from the QoreX demo dApp");
  expect(ed25519.verify(base58.decode(signature), message, base58.decode(qorex.addresses.svm))).toBe(true);
});
