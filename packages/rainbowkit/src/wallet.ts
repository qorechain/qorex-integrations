// SPDX-License-Identifier: Apache-2.0
//
// QoreX for RainbowKit. The connector is wagmi's `injected` connector pinned
// to the provider QoreX announces through EIP-6963; it never falls back to
// `window.ethereum`.

import type { Wallet, WalletDetailsParams } from "@rainbow-me/rainbowkit";
import { createConnector, injected, type CreateConnectorFn } from "wagmi";
import {
  QOREX_DOWNLOAD_URLS,
  QOREX_NAME,
  QOREX_RDNS,
  findQorexEip1193,
  type QorexEip1193Provider,
} from "@qorechain/qorex-types";
import { QOREX_ICON_DATA_URI } from "@qorechain/qorex-types/icon";

/** Background behind the QoreX icon in RainbowKit's lists. */
export const QOREX_ICON_BACKGROUND = "#EEE9FB";

export interface QorexConnectorOptions {
  /**
   * QoreX does not emit `accountsChanged` or `chainChanged` yet, so wagmi does
   * not see an account or network change made in the wallet. When true, the
   * connector re-reads `eth_accounts` and `eth_chainId` each time the page
   * regains focus or becomes visible while connected, and reports a change to
   * wagmi as if the wallet had emitted the event. An empty account list (the
   * wallet was locked or the site disconnected) disconnects. Default false.
   */
  readonly pollAccountsOnFocus?: boolean;
}

export interface QorexWalletOptions extends QorexConnectorOptions {
  /** Passed by RainbowKit to every wallet function; not used. */
  readonly projectId?: string;
  /** Passed by RainbowKit to every wallet function; not used. */
  readonly appName?: string;
}

/**
 * The QoreX EVM provider: the one announced through EIP-6963 with rdns
 * `network.qore.qorex`, or `window.qorex.evm` (the same object) if the
 * announcement is not seen.
 */
export function getQorexEip1193Provider(): QorexEip1193Provider | undefined {
  const announced = findQorexEip1193();
  if (announced) return announced;
  if (typeof window === "undefined") return undefined;
  const evm = window.qorex?.evm as Partial<QorexEip1193Provider> | undefined;
  return evm && evm.isQoreX === true && typeof evm.request === "function" ? (evm as QorexEip1193Provider) : undefined;
}

type InjectedConnector = ReturnType<ReturnType<typeof injected>>;

/**
 * wagmi connector for QoreX. `qorexWallet().createConnector` uses this; call
 * it directly only to use QoreX with plain wagmi.
 */
export function createQorexConnector(
  walletDetails: WalletDetailsParams,
  options: QorexConnectorOptions = {},
): CreateConnectorFn {
  const { id, name } = walletDetails.rkDetails;
  let cached: QorexEip1193Provider | undefined;
  const provider = (): QorexEip1193Provider | undefined => (cached ??= getQorexEip1193Provider());

  return createConnector((config) => {
    const base: InjectedConnector = injected({
      shimDisconnect: true,
      // An object target: wagmi then never substitutes window.ethereum.
      target: { id, name, icon: QOREX_ICON_DATA_URI, provider: provider as never },
    })(config);

    let stopPolling: (() => void) | undefined;

    const startPolling = (connector: InjectedConnector, accounts: readonly string[], chainId: number): void => {
      if (options.pollAccountsOnFocus !== true || typeof window === "undefined") return;
      stopPolling?.();
      let lastAccounts = accounts.map((a) => a.toLowerCase()).join(",");
      let lastChainId = chainId;
      let running = false;
      const check = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
          const p = provider();
          if (!p) return;
          const nextAccounts = (await p.request({ method: "eth_accounts" })) as string[];
          const nextChainHex = (await p.request({ method: "eth_chainId" })) as string;
          const accountsKey = nextAccounts.map((a) => a.toLowerCase()).join(",");
          const nextChainId = Number(nextChainHex);
          if (accountsKey !== lastAccounts) {
            lastAccounts = accountsKey;
            connector.onAccountsChanged(nextAccounts);
          }
          if (Number.isFinite(nextChainId) && nextChainId !== lastChainId) {
            lastChainId = nextChainId;
            connector.onChainChanged(nextChainHex);
          }
        } catch {
          // A failed read is not a change; the next focus retries.
        } finally {
          running = false;
        }
      };
      const onFocus = (): void => void check();
      const onVisibility = (): void => {
        if (document.visibilityState === "visible") void check();
      };
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
      stopPolling = () => {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
        stopPolling = undefined;
      };
    };

    const connect = async function (
      this: InjectedConnector,
      parameters?: Parameters<InjectedConnector["connect"]>[0],
    ) {
      const result = await base.connect.call(this, parameters);
      const accounts = (result.accounts as ReadonlyArray<string | { address: string }>).map((a) =>
        typeof a === "string" ? a : a.address,
      );
      startPolling(this, accounts, result.chainId);
      return result;
    } as InjectedConnector["connect"];

    const connector: InjectedConnector = {
      ...base,
      rdns: QOREX_RDNS,
      connect,
      async disconnect() {
        stopPolling?.();
        await base.disconnect.call(this);
      },
    };
    return { ...connector, ...walletDetails };
  });
}

/**
 * QoreX as a RainbowKit wallet.
 *
 * ```ts
 * connectorsForWallets([{ groupName: "Recommended", wallets: [qorexWallet] }], { appName, projectId });
 * // with options:
 * connectorsForWallets([{ groupName: "Recommended", wallets: [() => qorexWallet({ pollAccountsOnFocus: true })] }], { appName, projectId });
 * ```
 */
export function qorexWallet(options: QorexWalletOptions = {}): Wallet {
  const connectorOptions: QorexConnectorOptions = { pollAccountsOnFocus: options.pollAccountsOnFocus === true };
  return {
    id: "qorex",
    name: QOREX_NAME,
    rdns: QOREX_RDNS,
    iconUrl: QOREX_ICON_DATA_URI,
    iconBackground: QOREX_ICON_BACKGROUND,
    installed: typeof window === "undefined" ? undefined : getQorexEip1193Provider() !== undefined,
    downloadUrls: {
      chrome: QOREX_DOWNLOAD_URLS.chrome,
      edge: QOREX_DOWNLOAD_URLS.chrome,
      opera: QOREX_DOWNLOAD_URLS.chrome,
      firefox: QOREX_DOWNLOAD_URLS.firefox,
      safari: QOREX_DOWNLOAD_URLS.safari,
      macos: QOREX_DOWNLOAD_URLS.safari,
      browserExtension: QOREX_DOWNLOAD_URLS.chrome,
      ios: QOREX_DOWNLOAD_URLS.ios,
      android: QOREX_DOWNLOAD_URLS.android,
      mobile: QOREX_DOWNLOAD_URLS.website,
      qrCode: QOREX_DOWNLOAD_URLS.website,
    },
    extension: {
      instructions: {
        learnMoreUrl: QOREX_DOWNLOAD_URLS.website,
        steps: [
          {
            step: "install",
            title: "Install the QoreX extension",
            description: "Add QoreX to your browser and pin it to the toolbar so you can open it quickly.",
          },
          {
            step: "create",
            title: "Create or import a wallet",
            description: "Write down your recovery phrase and keep it offline. Never share it with anyone.",
          },
          {
            step: "refresh",
            title: "Refresh this page",
            description: "After setting up QoreX, refresh the page so it can find the extension.",
          },
        ],
      },
    },
    createConnector: (walletDetails) => createQorexConnector(walletDetails, connectorOptions),
  };
}
