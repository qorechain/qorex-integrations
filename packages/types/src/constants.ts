// SPDX-License-Identifier: Apache-2.0
//
// Identifiers QoreX and QoreChain use. Values match the QoreX extension 0.3.x
// and the QoreChain networks.

/** Reverse-DNS id QoreX announces in its EIP-6963 provider info. */
export const QOREX_RDNS = "network.qore.qorex" as const;

/** Display name QoreX announces (EIP-6963 and Wallet Standard). */
export const QOREX_NAME = "QoreX" as const;

/** QoreChain mainnet chain id (native lane). */
export const QORECHAIN_MAINNET_CHAIN_ID = "qorechain-vladi" as const;

/** QoreChain testnet chain id (native lane). */
export const QORECHAIN_TESTNET_CHAIN_ID = "qorechain-diana" as const;

/** Every QoreChain chain id QoreX serves. */
export const QORECHAIN_CHAIN_IDS = [QORECHAIN_MAINNET_CHAIN_ID, QORECHAIN_TESTNET_CHAIN_ID] as const;

export type QoreChainChainId = (typeof QORECHAIN_CHAIN_IDS)[number];

/** QoreChain mainnet EVM chain id (0x2649). */
export const QORECHAIN_MAINNET_EVM_CHAIN_ID = 9801 as const;

/** QoreChain testnet EVM chain id (0x2648). */
export const QORECHAIN_TESTNET_EVM_CHAIN_ID = 9800 as const;

/** Native capabilities a QoreX build may declare in `window.qorex.native.capabilities`. */
export const QOREX_NATIVE_CAPABILITIES = [
  "listAccounts",
  "connectProofPicksAccount",
  "executeRequest",
  "signAndBroadcast",
] as const;

/**
 * Capability a future QoreX release will declare when its `signDirect` adds
 * the hybrid ML-DSA-87 layer itself on QoreChain (for a SignDoc that has none).
 * Available from a future QoreX release; no current build declares it.
 * When present, QoreX re-estimates gas and may raise the gas limit and fee,
 * so the returned `signed.authInfoBytes` can differ from the page's, and it
 * refuses accounts without a registered ML-DSA-87 key.
 */
export const QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER = "signDirectAddsPqcLayer" as const;

/** True for `qorechain-vladi` and `qorechain-diana`. */
export function isQoreChainChainId(chainId: unknown): chainId is QoreChainChainId {
  return chainId === QORECHAIN_MAINNET_CHAIN_ID || chainId === QORECHAIN_TESTNET_CHAIN_ID;
}

/** Where users get QoreX. */
export const QOREX_DOWNLOAD_URLS = {
  /** Chrome Web Store (Chrome, Brave, Edge and other Chromium browsers). */
  chrome: "https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg",
  /** Firefox Add-ons. */
  firefox: "https://addons.mozilla.org/firefox/addon/qorex/",
  /** Mac App Store: the app that carries the Safari extension. */
  safari: "https://apps.apple.com/us/app/qorex-wallet/id6794132220",
  /** App Store (iPhone). */
  ios: "https://apps.apple.com/us/app/qorex/id6791256626",
  /** Google Play. */
  android: "https://play.google.com/store/apps/details?id=network.qore.qorex",
  /** Product site. */
  website: "https://www.qorechain.io",
} as const;

/**
 * Reverse-DNS id announced by `@qorechain/qorex-wallet-mock`, the test double
 * of QoreX. Distinct from `QOREX_RDNS` so a mock is never taken for the wallet.
 */
export const QOREX_MOCK_RDNS = "network.qore.qorex.mock" as const;

/** Display name announced by `@qorechain/qorex-wallet-mock`. */
export const QOREX_MOCK_NAME = "QoreX (mock)" as const;

/**
 * EIP-1193 error codes for QoreX's EVM provider.
 *
 * Today QoreX sets a code only when `wallet_switchEthereumChain` names a chain
 * other than the active one (4902). Planned for a future QoreX release:
 * `unsupportedMethod` (4200) on every method it does not answer and
 * `unrecognizedChain` (4902) on `wallet_switchEthereumChain` and
 * `wallet_addEthereumChain`, with the same message text as today. Check
 * `code` first and fall back to the message text; see
 * `isQorexUnsupportedMethodError` and `isQorexUnrecognizedChainError`.
 */
export const QOREX_EVM_ERROR_CODES = {
  unsupportedMethod: 4200,
  unrecognizedChain: 4902,
} as const;
