// SPDX-License-Identifier: Apache-2.0
//
// Wallet discovery the way a dApp does it: EIP-6963 for EVM, Wallet Standard
// for Solana, `window.qorex.native` for QoreChain.

import { QOREX_MOCK_RDNS, QOREX_RDNS, type Eip6963ProviderDetail, type QorexEip1193Provider } from "@qorechain/qorex-types";

export const CHAIN_ID = "qorechain-diana";
export const REST = (import.meta.env.VITE_QORE_REST as string | undefined) ?? "https://api-testnet.qore.host";
export const PQC_HYBRID_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature";

/** Every EIP-6963 announcement seen so far, by uuid. */
const announced = new Map<string, Eip6963ProviderDetail>();
window.addEventListener("eip6963:announceProvider", (ev) => {
  const detail = (ev as CustomEvent<Eip6963ProviderDetail>).detail;
  if (detail?.info?.uuid) announced.set(detail.info.uuid, detail);
});

export async function discoverEip6963(waitMs = 300): Promise<Eip6963ProviderDetail[]> {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, waitMs));
  return [...announced.values()];
}

/** QoreX, or the QoreX test double, among the announced providers. */
export function pickQorex(list: Eip6963ProviderDetail[]): Eip6963ProviderDetail<QorexEip1193Provider> | undefined {
  return list.find((d) => d.info.rdns === QOREX_RDNS || d.info.rdns === QOREX_MOCK_RDNS) as
    | Eip6963ProviderDetail<QorexEip1193Provider>
    | undefined;
}

export interface StandardWallet {
  name: string;
  chains: readonly string[];
  features: Record<string, Record<string, unknown>>;
}

const standardWallets: StandardWallet[] = [];
const api = { register: (w: StandardWallet) => void standardWallets.push(w) };
window.addEventListener("wallet-standard:register-wallet", (ev) => {
  (ev as CustomEvent<(a: typeof api) => void>).detail(api);
});
window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));

export function qorexSolanaWallet(): StandardWallet | undefined {
  return standardWallets.find((w) => w.name.startsWith("QoreX") && w.chains.includes("solana:mainnet"));
}

/** Reads the committed transaction back and reports whether it carries the hybrid layer. */
export async function readLayer(txHash: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${txHash}`);
    if (res.ok) {
      const body = (await res.json()) as { tx?: { body?: { extension_options?: Array<Record<string, unknown>> } } };
      const ext = body.tx?.body?.extension_options ?? [];
      return ext.some((e) => e["@type"] === PQC_HYBRID_TYPE_URL)
        ? "hybrid ML-DSA-87 layer present in the committed transaction"
        : "no hybrid layer in the committed transaction";
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "transaction not found yet";
}
