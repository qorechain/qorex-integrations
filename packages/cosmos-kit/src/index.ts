// SPDX-License-Identifier: Apache-2.0
//
// @qorechain/qorex-cosmos-kit: QoreX for cosmos-kit, with the QoreChain
// signAndBroadcast path.

import { QorexExtensionWallet } from "./main-wallet.js";
import { qorexExtensionInfo } from "./registry.js";

export { QorexClient, toCosmosKey, toUint8Array, type QorexCosmosKey } from "./client.js";
export { ChainQorexExtension, QorexExtensionWallet } from "./main-wallet.js";
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

/** The QoreX extension wallet instance. */
export const qorexExtension = new QorexExtensionWallet(qorexExtensionInfo);

/** Pass to `ChainProvider`'s `wallets`. */
export const wallets = [qorexExtension];
