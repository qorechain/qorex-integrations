// SPDX-License-Identifier: Apache-2.0

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { QOREX_CHAINS, qorechain, qorechainTestnet, qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

const connectors = connectorsForWallets(
  // pollAccountsOnFocus: QoreX does not emit accountsChanged / chainChanged yet.
  [{ groupName: "QoreChain", wallets: [() => qorexWallet({ pollAccountsOnFocus: true })] }],
  {
    appName: "QoreX example",
    // Only used by WalletConnect-based wallets; QoreX does not need it.
    projectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "unused",
  },
);

export const config = createConfig({
  chains: QOREX_CHAINS,
  connectors,
  transports: { [qorechain.id]: http(), [qorechainTestnet.id]: http() },
});
