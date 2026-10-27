// SPDX-License-Identifier: Apache-2.0
//
// Offline stand-in for the qorechain-diana REST endpoint, served through
// Playwright routing. Transactions the mock broadcasts are kept so the test
// can verify their signatures; nothing reaches the network.

import { createHash } from "node:crypto";
import {
  PQC_HYBRID_TYPE_URL,
  addressFromPublicKey,
  decodeTxRaw,
  deriveCanonicalPqKey,
  deriveClassicalKey,
  fromBase64,
  pqcLayers,
  toBase64,
} from "@qorechain/qoresign";
import type { Page, Route } from "@playwright/test";

export const REST = "https://api-testnet.qore.host";
export const ACCOUNT_NUMBER = 42n;

export interface StubbedTx {
  txBytes: Uint8Array;
  hash: string;
  hasLayer: boolean;
}

export interface ChainStub {
  txs: StubbedTx[];
  classicalPublicKey: Uint8Array;
  pqPublicKey: Uint8Array;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function reply(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** Keys the mock derives for `mnemonic`, account 0. */
export function testAccount(mnemonic: string) {
  const classical = deriveClassicalKey({ mnemonic });
  const address = addressFromPublicKey(classical.publicKey, "secp256k1").bech32;
  return { address, classical, pq: deriveCanonicalPqKey({ mnemonic, address }) };
}

export async function stubChain(page: Page, mnemonic: string): Promise<ChainStub> {
  const account = testAccount(mnemonic);
  const stub: ChainStub = { txs: [], classicalPublicKey: account.classical.publicKey, pqPublicKey: account.pq.publicKey };
  let sequence = 7n;
  await page.route(`${REST}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/cosmos/auth/v1beta1/account_info/")) {
      return reply(route, 200, { info: { account_number: ACCOUNT_NUMBER.toString(), sequence: sequence.toString() } });
    }
    if (path.startsWith("/qorechain/pqc/v1/account/")) {
      return reply(route, 200, {
        found: true,
        account: { public_key: toBase64(stub.pqPublicKey), algorithm_id: 1, key_type: "hybrid", possession_proven: true },
      });
    }
    if (path.startsWith("/cosmos/upgrade/v1beta1/applied_plan/")) return reply(route, 200, { height: "100" });
    if (path === "/cosmos/tx/v1beta1/txs" && req.method() === "POST") {
      const txBytes = fromBase64((req.postDataJSON() as { tx_bytes: string }).tx_bytes);
      const hash = createHash("sha256").update(txBytes).digest("hex").toUpperCase();
      stub.txs.push({ txBytes, hash, hasLayer: pqcLayers(decodeTxRaw(txBytes).bodyBytes).length > 0 });
      sequence += 1n;
      return reply(route, 200, { tx_response: { txhash: hash, code: 0, codespace: "", raw_log: "" } });
    }
    if (path.startsWith("/cosmos/tx/v1beta1/txs/")) {
      const hash = path.slice("/cosmos/tx/v1beta1/txs/".length);
      const tx = stub.txs.find((t) => t.hash === hash);
      if (!tx) return reply(route, 404, { code: 5, message: "tx not found" });
      return reply(route, 200, {
        tx_response: { txhash: hash, code: 0, height: "1000" },
        tx: { body: { extension_options: tx.hasLayer ? [{ "@type": PQC_HYBRID_TYPE_URL }] : [] } },
      });
    }
    return reply(route, 404, { message: `no stub for ${path}` });
  });
  return stub;
}
