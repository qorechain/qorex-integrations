// SPDX-License-Identifier: Apache-2.0
//
// Stand-in for the QoreX inpage script, EVM side, answering like the QoreX
// 0.3.x kernel: eth_chainId, eth_accounts, eth_requestAccounts and
// wallet_switchEthereumChain only.

import type { QorexEip1193Provider } from "@qorechain/qorex-types";
import { QOREX_ICON_DATA_URI } from "@qorechain/qorex-types/icon";

export interface FakeQorexState {
  chainHex: string;
  address: string;
  unlocked: boolean;
  connected: boolean;
}

export function installFakeQorex(initial: Partial<FakeQorexState> = {}) {
  const state: FakeQorexState = {
    chainHex: "0x2649",
    address: "0x1111111111111111111111111111111111111111",
    unlocked: true,
    connected: false,
    ...initial,
  };
  const methods: string[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    methods.push(method);
    if (method === "eth_chainId") return state.chainHex;
    if (method === "eth_accounts") return state.unlocked && state.connected ? [state.address] : [];
    if (!state.unlocked) throw new Error("QoreX: wallet is locked");
    if (method === "eth_requestAccounts") {
      state.connected = true;
      return [state.address];
    }
    if (method === "wallet_switchEthereumChain") {
      const target = (params as Array<{ chainId?: string }> | undefined)?.[0]?.chainId;
      if (!target || target.toLowerCase() === state.chainHex) return null;
      throw Object.assign(new Error(`QoreX: unrecognized chain ${target}`), { code: 4902 });
    }
    throw new Error(`QoreX: EVM method ${method} not yet supported`);
  };
  const evm: QorexEip1193Provider = { isQoreX: true, request, on: () => undefined, removeListener: () => undefined };
  const detail = {
    info: { uuid: "e8a13e78-5b40-4d3e-9f6a-0007e5000001", name: "QoreX", icon: QOREX_ICON_DATA_URI, rdns: "network.qore.qorex" },
    provider: evm,
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  (window as unknown as { qorex: unknown }).qorex = { evm, native: {}, svm: {} };
  return {
    state,
    methods,
    evm,
    uninstall() {
      window.removeEventListener("eip6963:requestProvider", announce);
      delete (window as unknown as { qorex?: unknown }).qorex;
    },
  };
}

/** A different wallet on window.ethereum that must never be called. */
export function installWindowEthereum() {
  const calls: string[] = [];
  const ethereum = {
    isMetaMask: true,
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      throw new Error("window.ethereum must not be used");
    },
    on: () => undefined,
    removeListener: () => undefined,
  };
  (window as unknown as { ethereum: unknown }).ethereum = ethereum;
  return { calls, uninstall: () => delete (window as unknown as { ethereum?: unknown }).ethereum };
}
