// SPDX-License-Identifier: Apache-2.0

import { ChainWalletBase, MainWalletBase, type ChainRecord, type EndpointOptions, type Wallet } from "@cosmos-kit/core";
import { getQorexNative } from "@qorechain/qorex-types";
import { QorexClient } from "./client.js";

/** Per-chain QoreX wallet (no QoreX-specific behaviour beyond the client). */
export class ChainQorexExtension extends ChainWalletBase {
  constructor(walletInfo: Wallet, chainInfo: ChainRecord) {
    super(walletInfo, chainInfo);
  }
}

const READY_TIMEOUT_MS = 3_000;

/** Waits for the page to finish loading if QoreX has not injected yet. */
async function waitForQorex(): Promise<ReturnType<typeof getQorexNative>> {
  const now = getQorexNative();
  if (now || typeof document === "undefined" || document.readyState === "complete") return now;
  return new Promise((resolve) => {
    const done = (): void => {
      document.removeEventListener("readystatechange", onChange);
      clearTimeout(timer);
      resolve(getQorexNative());
    };
    const onChange = (): void => {
      if (document.readyState === "complete") done();
    };
    document.addEventListener("readystatechange", onChange);
    const timer = setTimeout(done, READY_TIMEOUT_MS);
  });
}

/** cosmos-kit main wallet for the QoreX extension. */
export class QorexExtensionWallet extends MainWalletBase {
  constructor(walletInfo: Wallet, preferredEndpoints?: EndpointOptions["endpoints"]) {
    super(walletInfo, ChainQorexExtension);
    this.preferredEndpoints = preferredEndpoints;
  }

  async initClient(): Promise<void> {
    this.initingClient();
    try {
      const native = await waitForQorex();
      this.initClientDone(native ? new QorexClient(native) : undefined);
    } catch (error) {
      this.initClientError(error as Error);
    }
  }
}
