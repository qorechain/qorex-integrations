// SPDX-License-Identifier: Apache-2.0

import { QOREX_MOCK_NAME, QOREX_MOCK_RDNS, type QorexEip1193Provider } from "@qorechain/qorex-types";
import { QOREX_ICON_DATA_URI } from "@qorechain/qorex-types/icon";
import type { MockController, QorexMockRequest } from "./controller.js";
import { createEvmProvider } from "./evm.js";
import { createNativeProvider, type QorexMockNativeProvider } from "./native.js";
import type { QorexMockChainId, QorexMockProfile } from "./options.js";
import { createSvm, registerStandardWallet, type QorexMockSvmProvider } from "./svm.js";

/** EIP-6963 uuid of the mock (QoreX uses its own). */
export const QOREX_MOCK_UUID = "6f1c3c0e-8d9a-4c1e-9b7a-000000000ac1";

/** What the mock writes to `window.qorex`. */
export interface QorexMockInjected {
  readonly evm: QorexEip1193Provider;
  readonly native: QorexMockNativeProvider;
  readonly svm: QorexMockSvmProvider;
}

/** Addresses of the selected account on each lane. */
export interface QorexMockAddresses {
  /** `qor1...` */
  readonly native: string;
  /** EIP-55 `0x...` */
  readonly evm: string;
  /** Base58 Solana public key. */
  readonly svm: string;
}

/**
 * Control handle of an installed mock, also written to `window.__qorexMock`
 * so a Playwright test can reach it with `page.evaluate`.
 */
export interface QorexMockControl {
  readonly profile: QorexMockProfile;
  /** Grants the next approval (or the one waiting now). */
  approveNext(): void;
  /** Refuses the next approval (or the one waiting now). */
  rejectNext(): void;
  /** Number of approvals waiting for `approveNext` / `rejectNext` (with `autoApprove: false`). */
  readonly pendingApprovals: number;
  /** Every call the page made, oldest first. */
  readonly requests: readonly QorexMockRequest[];
  clearRequests(): void;
  /** Selects another account index; emits `accountsChanged` in the planned profile. */
  switchAccount(index: number): void;
  /** Selects the other QoreChain network; emits `chainChanged` in the planned profile. REST and EVM endpoints do not change. */
  switchNetwork(chainId: QorexMockChainId): void;
  /** Forgets the site connection, as if the user disconnected it in the wallet. */
  disconnect(): void;
  addresses(): QorexMockAddresses;
}

declare global {
  interface Window {
    __qorexMock?: QorexMockControl;
  }
}

export function controlFor(ctl: MockController): QorexMockControl {
  return {
    profile: ctl.options.profile,
    approveNext: () => ctl.approveNext(),
    rejectNext: () => ctl.rejectNext(),
    get pendingApprovals() {
      return ctl.pendingApprovals;
    },
    get requests() {
      return ctl.log.map((r) => ({ ...r }));
    },
    clearRequests: () => {
      ctl.log.length = 0;
    },
    switchAccount: (index) => ctl.switchAccount(index),
    switchNetwork: (chainId) => ctl.switchNetwork(chainId),
    disconnect: () => {
      ctl.connected = false;
    },
    addresses: () => ({
      native: ctl.account.native.address,
      evm: ctl.account.evm.address,
      svm: ctl.account.svm.address,
    }),
  };
}

/** Injects the providers into `win`, announces EIP-6963 and registers the Solana wallet. */
export function installInto(win: Window, ctl: MockController): QorexMockControl {
  const evm = createEvmProvider(ctl);
  const native = createNativeProvider(ctl);
  const { shim, standardWallet } = createSvm(ctl);
  const injected: QorexMockInjected = { evm, native, svm: shim };

  const detail = Object.freeze({
    info: Object.freeze({ uuid: QOREX_MOCK_UUID, name: QOREX_MOCK_NAME, icon: QOREX_ICON_DATA_URI, rdns: QOREX_MOCK_RDNS }),
    provider: evm,
  });
  const Custom = (win as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  const announce = () => win.dispatchEvent(new Custom("eip6963:announceProvider", { detail }));
  win.addEventListener("eip6963:requestProvider", announce);
  announce();

  registerStandardWallet(win, standardWallet);

  (win as unknown as { qorex: unknown }).qorex = injected;
  const control = controlFor(ctl);
  win.__qorexMock = control;
  return control;
}
