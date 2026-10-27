// SPDX-License-Identifier: Apache-2.0

import { getQorexNative } from "./detect.js";
import { QOREX_NOT_INSTALLED_MESSAGE, QorexIntegrationError, notSupportedYetMessage } from "./errors.js";
import type {
  QorexNativeProvider,
  QorexSignAndBroadcastRequest,
  QorexSignAndBroadcastResult,
} from "./providers.js";

export interface QorexSignAndBroadcastOptions {
  /** Provider to use. Default: `window.qorex.native`. */
  readonly native?: Pick<QorexNativeProvider, "signAndBroadcast">;
}

/**
 * The QoreChain path for a dApp transaction: hands the messages to QoreX,
 * which shows them to the user, sets the fee, adds the hybrid secp256k1 +
 * ML-DSA-87 (FIPS 204) signature and broadcasts. The request is passed
 * through unchanged.
 *
 * Throws `QOREX_NOT_INSTALLED` without QoreX and `QOREX_NOT_SUPPORTED_YET`
 * when the installed QoreX predates `signAndBroadcast`. Errors from QoreX
 * itself (rejection, wrong network, refused message type) are rethrown as is.
 *
 * ```ts
 * const { txHash, code, shield } = await qorexSignAndBroadcast({
 *   chainId: "qorechain-diana",
 *   messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: MsgSend.encode(msg).finish() }],
 *   memo: "hello",
 * });
 * ```
 */
export async function qorexSignAndBroadcast(
  request: QorexSignAndBroadcastRequest,
  options: QorexSignAndBroadcastOptions = {},
): Promise<QorexSignAndBroadcastResult> {
  const native = options.native ?? getQorexNative();
  if (!native) throw new QorexIntegrationError("QOREX_NOT_INSTALLED", QOREX_NOT_INSTALLED_MESSAGE);
  if (typeof native.signAndBroadcast !== "function") {
    throw new QorexIntegrationError(
      "QOREX_NOT_SUPPORTED_YET",
      notSupportedYetMessage("signAndBroadcast in this QoreX version; update QoreX"),
    );
  }
  return native.signAndBroadcast(request);
}
