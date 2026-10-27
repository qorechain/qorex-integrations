// SPDX-License-Identifier: Apache-2.0
//
// Stand-in for `window.qorex.native`, answering in the shapes the QoreX
// extension returns over the page bridge (bytes as number[], account number
// as a decimal string). `supportedChains` defaults to the QoreChain ids, as
// in QoreX 0.3.x; tests widen it to exercise other chains.

import type { QorexNativeProvider } from "@qorechain/qorex-types";

export const PUBKEY = Array.from({ length: 33 }, (_, i) => (i === 0 ? 2 : i));
export const ADDRESS = Array.from({ length: 20 }, (_, i) => 100 + i);
export const BECH32 = "qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";

export interface FakeOptions {
  supportedChains?: string[];
  capabilities?: string[];
  /** Applied to the signed document, as a future QoreX may do when it adds the PQC layer. */
  rewriteAuthInfo?: (bytes: number[]) => number[];
}

export function installFakeQorex(options: FakeOptions = {}) {
  const supported = options.supportedChains ?? ["qorechain-vladi", "qorechain-diana"];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const requireChain = (chainId: string) => {
    if (chainId && !supported.includes(chainId)) throw new Error(`QoreX: unsupported chain ${chainId}`);
  };
  const native = {
    isQoreX: true,
    capabilities: options.capabilities ?? ["listAccounts", "connectProofPicksAccount", "executeRequest", "signAndBroadcast"],
    async enable(chainId: string) {
      calls.push({ method: "enable", args: [chainId] });
      requireChain(chainId);
      return null;
    },
    async getKey(chainId: string) {
      calls.push({ method: "getKey", args: [chainId] });
      requireChain(chainId);
      return {
        name: "QoreX",
        algo: "secp256k1",
        pubKey: [...PUBKEY],
        address: [...ADDRESS],
        bech32Address: BECH32,
        pubKeyHex: PUBKEY.map((b) => b.toString(16).padStart(2, "0")).join(""),
        isNanoLedger: false,
      };
    },
    async signDirect(signerAddress: string, signDoc: { bodyBytes: unknown; authInfoBytes: unknown; chainId: string; accountNumber: unknown }) {
      calls.push({ method: "signDirect", args: [signerAddress, signDoc] });
      // What crosses the bridge must be JSON: no Uint8Array, no bigint.
      JSON.stringify(signDoc);
      if (!Array.isArray(signDoc.bodyBytes) || !Array.isArray(signDoc.authInfoBytes)) throw new Error("expected number[]");
      requireChain(signDoc.chainId);
      const authInfo = signDoc.authInfoBytes as number[];
      return {
        signature: { pub_key: { type: "secp256k1", value: "AgEC" }, signature: "c2ln" },
        signed: {
          bodyBytes: [...(signDoc.bodyBytes as number[])],
          authInfoBytes: options.rewriteAuthInfo ? options.rewriteAuthInfo(authInfo) : [...authInfo],
          chainId: signDoc.chainId,
          accountNumber: String(signDoc.accountNumber),
        },
      };
    },
    async signAndBroadcast(req: unknown) {
      calls.push({ method: "signAndBroadcast", args: [req] });
      return { txHash: "ABCDEF", code: 0, height: 42, shield: "shielded" };
    },
    async signArbitrary() {
      calls.push({ method: "signArbitrary", args: [] });
      throw new Error("QoreX: signArbitrary not yet supported");
    },
    async experimentalSuggestChain(chainInfo: { chainId?: string }) {
      calls.push({ method: "experimentalSuggestChain", args: [chainInfo] });
      if (chainInfo.chainId?.startsWith("qorechain-")) return null;
      throw Object.assign(new Error(`QoreX supports QoreChain networks only, cannot add ${chainInfo.chainId}`), { code: 4902 });
    },
    async connectProof() {
      throw new Error("QoreX: not allowed");
    },
    async executeTransfer() {
      throw new Error("QoreX: not allowed");
    },
    async executeRequest() {
      throw new Error("QoreX: not allowed");
    },
    async listAccounts() {
      return { accounts: [{ index: 0, label: "Account 1", address: BECH32 }], activeIndex: 0 };
    },
  } as unknown as QorexNativeProvider;
  (window as unknown as { qorex: unknown }).qorex = { evm: {}, native, svm: {} };
  return { native, calls, uninstall: () => delete (window as unknown as { qorex?: unknown }).qorex };
}

export const signDoc = (chainId: string) => ({
  bodyBytes: new Uint8Array([10, 1, 2]),
  authInfoBytes: new Uint8Array([18, 3, 4]),
  chainId,
  accountNumber: 7n,
});
