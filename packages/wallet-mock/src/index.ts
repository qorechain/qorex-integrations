// SPDX-License-Identifier: Apache-2.0
//
// @qorechain/qorex-wallet-mock: a test double of the QoreX wallet. It injects
// `window.qorex = { evm, native, svm }`, announces EIP-6963 as
// "QoreX (mock)" (rdns `network.qore.qorex.mock`) and registers a Solana
// Wallet Standard wallet. Signing is real: hybrid secp256k1 + ML-DSA-87
// (FIPS 204) through QoreSign on the native lane, secp256k1 on EVM, ed25519
// on Solana.

import { MockController } from "./controller.js";
import { installInto, type QorexMockAddresses, type QorexMockControl } from "./install.js";
import { MockAccount } from "./keys.js";
import { resolveOptions, type QorexMockChainId, type QorexMockOptions, type ResolvedOptions } from "./options.js";

export { PUBLIC_TEST_MNEMONIC } from "./keys.js";
export { QOREX_MOCK_UUID } from "./install.js";
export { PLANNED_MIN_HYBRID_GAS, WALLET_ONLY_TYPE_URLS, feeForGas, raiseGasForLayer } from "./native.js";
export type { QorexMockNativeProvider, QorexMockOfflineSigner } from "./native.js";
export type { QorexMockSvmProvider, QorexMockSolanaWallet } from "./svm.js";
export type { QorexMockAddresses, QorexMockControl, QorexMockInjected } from "./install.js";
export type { QorexMockRequest } from "./controller.js";
export type { QorexMockChainId, QorexMockOptions, QorexMockProfile } from "./options.js";
export { QOREX_MOCK_NAME, QOREX_MOCK_RDNS } from "@qorechain/qorex-types";

/** Global name of the page script (`dist/inpage.global.js`). */
export const QOREX_MOCK_GLOBAL = "QorexWalletMock";

export interface QorexMock {
  /** Options after defaults (without `fetch`). */
  readonly options: Readonly<ResolvedOptions>;
  /** Addresses of the configured account, derived locally. */
  addresses(): QorexMockAddresses;
  /**
   * Installs the mock into a window in this process (jsdom, a browser
   * bundle). The approval and log methods below act on this installation.
   */
  install(win?: Window): QorexMockControl;
  /**
   * Self-contained script for Playwright `page.addInitScript({ content })`.
   * Node only: reads the bundled page script from this package.
   */
  initScript(): string;
  approveNext(): void;
  rejectNext(): void;
  readonly requests: QorexMockControl["requests"];
  clearRequests(): void;
  switchAccount(index: number): void;
  switchNetwork(chainId: QorexMockChainId): void;
}

function readPageScript(): string {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.("node:fs") as { readFileSync(p: URL, enc: "utf8"): string; existsSync(p: URL): boolean } | undefined;
  if (!fs) throw new Error("QoreX (mock): initScript() needs Node 20.16 or later; in a browser call install(window).");
  for (const rel of ["./inpage.global.js", "../dist/inpage.global.js"]) {
    const url = new URL(rel, import.meta.url);
    if (fs.existsSync(url)) return fs.readFileSync(url, "utf8");
  }
  throw new Error("QoreX (mock): dist/inpage.global.js is missing; build the package first.");
}

/** Creates a mock wallet. Nothing is injected until `install()` or `initScript()`. */
export function createQorexMock(options: QorexMockOptions = {}): QorexMock {
  const resolved = resolveOptions(options);
  const ctl = new MockController(resolved, options.fetch);
  let control: QorexMockControl | undefined;
  const local = new MockAccount(resolved.mnemonic, resolved.accountIndex);
  const installed = (): QorexMockControl => {
    if (!control) throw new Error("QoreX (mock): call install() first; with Playwright use the page's window.__qorexMock.");
    return control;
  };

  return {
    options: Object.freeze({ ...resolved }),
    addresses: () => ({ native: local.native.address, evm: local.evm.address, svm: local.svm.address }),
    install(win?: Window) {
      const target = win ?? (globalThis as { window?: Window }).window;
      if (!target) throw new Error("QoreX (mock): install() needs a window");
      control = installInto(target, ctl);
      return control;
    },
    initScript() {
      return `${readPageScript()}\n;${QOREX_MOCK_GLOBAL}.installFromConfig(window, ${JSON.stringify(resolved)});\n`;
    },
    approveNext: () => ctl.approveNext(),
    rejectNext: () => ctl.rejectNext(),
    get requests() {
      return installed().requests;
    },
    clearRequests: () => installed().clearRequests(),
    switchAccount: (index) => ctl.switchAccount(index),
    switchNetwork: (chainId) => ctl.switchNetwork(chainId),
  };
}
