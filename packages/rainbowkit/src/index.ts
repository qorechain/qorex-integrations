// SPDX-License-Identifier: Apache-2.0
//
// @qorechain/qorex-rainbowkit: QoreX as a RainbowKit wallet, plus viem chain
// definitions for the QoreChain EVM lane.

export {
  QOREX_ICON_BACKGROUND,
  createQorexConnector,
  getQorexEip1193Provider,
  qorexWallet,
  type QorexConnectorOptions,
  type QorexWalletOptions,
} from "./wallet.js";
export { QOREX_CHAINS, qorechain, qorechainTestnet } from "./chains.js";
export { QOREX_RDNS } from "@qorechain/qorex-types";
