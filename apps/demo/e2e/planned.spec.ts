// SPDX-License-Identifier: Apache-2.0
//
// The demo against the mock in the "planned" profile: what QoreX has
// announced for future releases.

import { PUBLIC_TEST_MNEMONIC } from "@qorechain/qorex-wallet-mock";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";
import { verifyHybridTx, verifyMessage, type MessageSignature } from "@qorechain/qoresign";
import { recoverMessageAddress, recoverTypedDataAddress, stringToHex } from "viem";
import { ACCOUNT_NUMBER, stubChain, testAccount } from "./chain-stub";
import { expect, out, run } from "./helpers";

const test = qorexMockFixtures({ profile: "planned", pollIntervalMs: 100 });
const MESSAGE = "Hello from the QoreX demo dApp";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await run(page, "evm-discover");
  await run(page, "evm-connect");
});

test("personal_sign and eth_signTypedData_v4 are signed by the EVM account", async ({ page, qorex }) => {
  const evm = qorex.addresses.evm as `0x${string}`;
  await run(page, "evm-personal-sign");
  const sig = ((await out(page, "evm-personal-sign").textContent()) ?? "") as `0x${string}`;
  expect(await recoverMessageAddress({ message: { raw: stringToHex(MESSAGE) }, signature: sig })).toBe(evm);

  await run(page, "evm-typed-data");
  const typedSig = ((await out(page, "evm-typed-data").textContent()) ?? "") as `0x${string}`;
  const signer = await recoverTypedDataAddress({
    domain: { name: "QoreX demo", version: "1", chainId: 9800 },
    types: {
      Greeting: [
        { name: "from", type: "address" },
        { name: "contents", type: "string" },
      ],
    },
    primaryType: "Greeting",
    message: { from: evm, contents: MESSAGE },
    signature: typedSig,
  });
  expect(signer).toBe(evm);
});

test("unknown chains carry code 4902", async ({ page }) => {
  await run(page, "evm-switch-other", "error");
  await expect(out(page, "evm-switch-other")).toContainText('"code": 4902');
  await expect(out(page, "evm-switch-other")).toContainText("QoreX: unrecognized chain 0x1");
});

test("accountsChanged reaches the page on connect and on an account switch", async ({ page, qorex }) => {
  await expect(out(page, "evm-events")).toContainText(`accountsChanged ["${qorex.addresses.evm}"]`);
  await qorex.switchAccount(1);
  await expect(out(page, "evm-events")).toContainText("accountsChanged", { timeout: 5_000 });
  const text = (await out(page, "evm-events").textContent()) ?? "";
  expect(text.split("\n")).toHaveLength(2);
});

test("QoreChain: hybrid send and signArbitrary", async ({ page }) => {
  const chain = await stubChain(page, PUBLIC_TEST_MNEMONIC);
  const { address, pq } = testAccount(PUBLIC_TEST_MNEMONIC);
  await run(page, "cosmos-get-key");
  await run(page, "cosmos-send");
  await expect(out(page, "cosmos-layer")).toHaveText("hybrid ML-DSA-87 layer present in the committed transaction");
  expect(
    verifyHybridTx({
      txBytes: chain.txs[0]!.txBytes,
      chainId: "qorechain-diana",
      accountNumber: ACCOUNT_NUMBER,
      classicalPublicKey: chain.classicalPublicKey,
      pqPublicKey: chain.pqPublicKey,
    }).valid,
  ).toBe(true);

  await run(page, "cosmos-sign-arbitrary");
  const signature = JSON.parse((await out(page, "cosmos-sign-arbitrary").textContent()) ?? "{}") as MessageSignature;
  expect(signature.signatureType).toBe("ml-dsa-87-hybrid");
  expect(() =>
    verifyMessage({ chainId: "qorechain-diana", signer: address, data: MESSAGE, signature, pqPublicKey: pq.publicKey }),
  ).not.toThrow();
});
