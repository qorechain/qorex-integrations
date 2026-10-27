// SPDX-License-Identifier: Apache-2.0
//
// viem chain definitions for the QoreChain EVM lane.
//
// The EVM lane accepts a transaction only when the sender has a registered
// ML-DSA-87 key and an open EVM authorization window, both set up from the
// native lane.

import { defineChain } from "viem";

const nativeCurrency = { name: "QOR", symbol: "QOR", decimals: 18 } as const;

/** QoreChain mainnet, EVM chain id 9801. */
export const qorechain = defineChain({
  id: 9801,
  name: "QoreChain",
  nativeCurrency,
  rpcUrls: {
    default: { http: ["https://evm.qore.host"] },
  },
  blockExplorers: {
    default: { name: "QoreChain Explorer", url: "https://explore.qore.network" },
  },
});

/** QoreChain testnet, EVM chain id 9800. */
export const qorechainTestnet = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency,
  rpcUrls: {
    default: { http: ["https://evm-testnet.qore.host"] },
  },
  blockExplorers: {
    default: { name: "QoreChain Explorer", url: "https://explore.qore.network" },
  },
  testnet: true,
});

/** Both QoreChain EVM chains, mainnet first. Pass to wagmi or RainbowKit `chains`. */
export const QOREX_CHAINS = [qorechain, qorechainTestnet] as const;
