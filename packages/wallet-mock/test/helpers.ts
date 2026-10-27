// SPDX-License-Identifier: Apache-2.0
//
// Test helpers: a fresh jsdom window per test and an in-memory stand-in for
// the QoreChain REST and EVM JSON-RPC endpoints.

import { sha256 } from "@noble/hashes/sha2.js";
import {
  PQC_HYBRID_TYPE_URL,
  decodeTxRaw,
  fromBase64,
  pqcLayers,
  toBase64,
  toHex,
} from "@qorechain/qoresign";
import type { FetchLike } from "@qorechain/qoresign/network";
import { JSDOM } from "jsdom";
import { bodyMessageTypeUrls } from "../src/proto.js";

export function freshWindow(): Window {
  return new JSDOM("<!doctype html><html><body></body></html>", { url: "https://dapp.example/" }).window as unknown as Window;
}

export interface StubTx {
  txBytes: Uint8Array;
  hash: string;
  typeUrls: string[];
  hasLayer: boolean;
}

export interface ChainStub {
  fetch: FetchLike;
  txs: StubTx[];
  evmRaw: string[];
  /** Registered ML-DSA-87 public key; undefined when the account has none. */
  registered?: Uint8Array;
  sequence: bigint;
  accountNumber: bigint;
  /** Result code the broadcast returns. */
  broadcastCode: number;
  calls: string[];
}

const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

export function chainStub(opts: { registered?: Uint8Array; pqPublicKey: Uint8Array }): ChainStub {
  const stub: ChainStub = {
    txs: [],
    evmRaw: [],
    registered: opts.registered,
    sequence: 3n,
    accountNumber: 42n,
    broadcastCode: 0,
    calls: [],
    fetch: async (url, init) => {
      const u = new URL(url);
      stub.calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.hostname.startsWith("evm")) {
        const req = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
        switch (req.method) {
          case "eth_getTransactionCount":
            return json(200, { jsonrpc: "2.0", id: 1, result: "0x5" });
          case "eth_estimateGas":
            return json(200, { jsonrpc: "2.0", id: 1, result: "0x5208" });
          case "eth_gasPrice":
            return json(200, { jsonrpc: "2.0", id: 1, result: "0x3b9aca00" });
          case "eth_sendRawTransaction":
            stub.evmRaw.push(req.params[0] as string);
            return json(200, { jsonrpc: "2.0", id: 1, result: `0x${"ab".repeat(32)}` });
          default:
            return json(200, { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } });
        }
      }
      const path = u.pathname;
      if (path.startsWith("/cosmos/auth/v1beta1/account_info/")) {
        return json(200, { info: { account_number: stub.accountNumber.toString(), sequence: stub.sequence.toString() } });
      }
      if (path.startsWith("/qorechain/pqc/v1/account/")) {
        if (!stub.registered) return json(404, { found: false });
        return json(200, {
          found: true,
          account: { public_key: toBase64(stub.registered), algorithm_id: 1, key_type: "hybrid", possession_proven: true },
        });
      }
      if (path.startsWith("/cosmos/upgrade/v1beta1/applied_plan/")) return json(200, { height: "100" });
      if (path === "/cosmos/tx/v1beta1/txs" && init?.method === "POST") {
        const txBytes = fromBase64((JSON.parse(init.body ?? "{}") as { tx_bytes: string }).tx_bytes);
        const tx = decodeTxRaw(txBytes);
        const hash = toHex(sha256(txBytes)).toUpperCase();
        const typeUrls = bodyMessageTypeUrls(tx.bodyBytes);
        stub.txs.push({ txBytes, hash, typeUrls, hasLayer: pqcLayers(tx.bodyBytes).length > 0 });
        if (stub.broadcastCode !== 0) {
          return json(200, { tx_response: { txhash: hash, code: stub.broadcastCode, codespace: "sdk", raw_log: "refused" } });
        }
        if (typeUrls.includes("/qorechain.pqc.v1.MsgRegisterPQCKeyV2")) stub.registered = opts.pqPublicKey;
        stub.sequence += 1n;
        return json(200, { tx_response: { txhash: hash, code: 0, codespace: "", raw_log: "" } });
      }
      if (path.startsWith("/cosmos/tx/v1beta1/txs/")) {
        const hash = decodeURIComponent(path.slice("/cosmos/tx/v1beta1/txs/".length));
        const t = stub.txs.find((x) => x.hash === hash);
        if (!t) return json(404, { code: 5, message: "tx not found" });
        return json(200, {
          tx_response: { txhash: hash, code: 0, height: "1234" },
          tx: { body: { extension_options: t.hasLayer ? [{ "@type": PQC_HYBRID_TYPE_URL }] : [] } },
        });
      }
      return json(404, { message: `no stub for ${path}` });
    },
  };
  return stub;
}

export async function rejection(p: Promise<unknown>): Promise<Error & { code?: number }> {
  try {
    await p;
  } catch (err) {
    return err as Error & { code?: number };
  }
  throw new Error("expected a rejection");
}
