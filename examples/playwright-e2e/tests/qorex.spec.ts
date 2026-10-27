// SPDX-License-Identifier: Apache-2.0
//
// A dApp page tested with the QoreX mock. The page is served by Playwright
// routing, so the example needs no web server; point `page.goto` at your
// own dApp instead.

import { expect } from "@playwright/test";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";

const test = qorexMockFixtures({ profile: "current", chainId: "qorechain-diana" });

const DAPP = "https://dapp.example/";
const PAGE = `<!doctype html>
<button id="connect">Connect QoreX</button>
<output id="result"></output>
<script>
  let qorex;
  window.addEventListener("eip6963:announceProvider", (e) => {
    if (e.detail.info.rdns.startsWith("network.qore.qorex")) qorex = e.detail.provider;
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  document.getElementById("connect").onclick = async () => {
    const out = document.getElementById("result");
    try {
      const [account] = await qorex.request({ method: "eth_requestAccounts" });
      out.textContent = "connected " + account;
    } catch (err) {
      out.textContent = "error " + err.message;
    }
  };
</script>`;

test.beforeEach(async ({ page }) => {
  await page.route(DAPP, (route) => route.fulfill({ contentType: "text/html", body: PAGE }));
  await page.goto(DAPP);
});

test("connects with QoreX", async ({ page, qorex }) => {
  await page.click("#connect");
  await expect(page.locator("#result")).toHaveText(`connected ${qorex.addresses.evm}`);
});

test("shows the wallet's refusal", async ({ page, qorex }) => {
  await qorex.rejectNext();
  await page.click("#connect");
  await expect(page.locator("#result")).toHaveText("error QoreX: connection rejected");
});

test("EVM signing is not available in QoreX today", async ({ page }) => {
  await page.click("#connect");
  const error = await page.evaluate(async () => {
    const q = (window as unknown as { qorex: { evm: { request(a: unknown): Promise<unknown> } } }).qorex;
    try {
      await q.evm.request({ method: "personal_sign", params: ["0x00", "0x0"] });
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  });
  expect(error).toBe("QoreX: EVM method personal_sign not yet supported");
});
