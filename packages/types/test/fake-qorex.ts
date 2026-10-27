// SPDX-License-Identifier: Apache-2.0
//
// Minimal stand-in for the QoreX inpage script: same object shapes, same
// EIP-6963 behaviour (announce once on load and on every request).

import type { QorexEip1193Provider, QorexInjected, QorexNativeProvider, QorexSvmProvider } from "../src/index.js";
import { QOREX_ICON_DATA_URI } from "../src/icon.js";

export type Call = { method: string; params: unknown };

export function installFakeQorex(answer: (method: string, params: unknown) => unknown = () => null) {
  const calls: Call[] = [];
  const call = async (method: string, params?: unknown) => {
    calls.push({ method, params });
    return answer(method, params);
  };
  const evm: QorexEip1193Provider = {
    isQoreX: true,
    request: (args) => call("evm:request", args),
    on: () => undefined,
    removeListener: () => undefined,
  };
  const native = {
    isQoreX: true,
    capabilities: ["listAccounts", "connectProofPicksAccount", "executeRequest", "signAndBroadcast"],
    enable: (chainId: string) => call("native:enable", { chainId }),
    getKey: (chainId: string) => call("native:getKey", { chainId }),
    signDirect: (signerAddress: string, signDoc: unknown) => call("native:signDirect", { signerAddress, signDoc }),
    signAndBroadcast: (req: unknown) => call("native:signAndBroadcast", req),
    signArbitrary: (chainId: string, signer: string, data: unknown) => call("native:signArbitrary", { chainId, signer, data }),
    experimentalSuggestChain: (chainInfo: unknown) => call("native:suggestChain", { chainInfo }),
    connectProof: (sessionId: string) => call("native:connectProof", { sessionId }),
    executeTransfer: (req: unknown) => call("native:executeTransfer", req),
    executeRequest: (params: unknown) => call("native:executeRequest", params),
    listAccounts: () => call("native:listAccounts", {}),
  } as unknown as QorexNativeProvider;
  const svm = {
    isQoreX: true,
    connect: () => call("svm:connect"),
    signAndSendTransaction: (tx: unknown) => call("svm:signAndSendTransaction", { tx }),
    signMessage: (message: unknown) => call("svm:signMessage", { message }),
  } as unknown as QorexSvmProvider;

  const detail = {
    info: { uuid: "e8a13e78-5b40-4d3e-9f6a-0007e5000001", name: "QoreX", icon: QOREX_ICON_DATA_URI, rdns: "network.qore.qorex" },
    provider: evm,
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  const injected: QorexInjected = { evm, native, svm };
  window.qorex = injected;
  return {
    calls,
    injected,
    uninstall() {
      window.removeEventListener("eip6963:requestProvider", announce);
      delete window.qorex;
    },
  };
}

/** Another wallet announcing itself through EIP-6963. */
export function installOtherWallet(rdns: string, name = "Other") {
  const provider = { request: async () => "other" };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: { info: { uuid: crypto.randomUUID(), name, icon: "data:image/svg+xml,<svg/>", rdns }, provider },
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  return { provider, uninstall: () => window.removeEventListener("eip6963:requestProvider", announce) };
}
