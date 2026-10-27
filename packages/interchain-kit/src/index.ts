// SPDX-License-Identifier: Apache-2.0
//
// @qorechain/qorex-interchain-kit: QoreX for Interchain Kit, with the
// QoreChain signAndBroadcast path.

import { ExtensionWallet } from "@interchain-kit/core";
import { QorexCosmosWallet } from "./cosmos-wallet.js";
import { qorexExtensionInfo } from "./registry.js";

export { QorexCosmosWallet, toCosmosKey, toUint8Array, type QorexCosmosKey } from "./cosmos-wallet.js";
export { qorexExtensionInfo } from "./registry.js";
export {
  QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER,
  QORECHAIN_CHAIN_IDS,
  QORECHAIN_MAINNET_CHAIN_ID,
  QORECHAIN_TESTNET_CHAIN_ID,
  QorexIntegrationError,
  isQoreChainChainId,
  isQorexIntegrationError,
  qorexSignAndBroadcast,
  type QorexIntegrationErrorCode,
  type QorexSignAndBroadcastOptions,
  type QorexSignAndBroadcastRequest,
  type QorexSignAndBroadcastResult,
} from "@qorechain/qorex-types";

/** Builds a QoreX wallet: an extension wallet with the QoreX Cosmos wallet for `cosmos` chains. */
export function createQorexWallet(): ExtensionWallet {
  const wallet = new ExtensionWallet(qorexExtensionInfo);
  wallet.setNetworkWallet("cosmos", new QorexCosmosWallet(qorexExtensionInfo));
  return wallet;
}

/** The QoreX wallet. Pass to `ChainProvider`'s `wallets`. */
export const qorexWallet = createQorexWallet();
