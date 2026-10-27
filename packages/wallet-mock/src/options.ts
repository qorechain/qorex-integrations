// SPDX-License-Identifier: Apache-2.0

import type { FetchLike } from "@qorechain/qoresign/network";
import { PUBLIC_TEST_MNEMONIC } from "./keys.js";

/**
 * - `current`: what QoreX does today, with the same error messages.
 * - `planned`: adds what QoreX has announced for future releases (EVM events,
 *   EIP-1193 error codes, EVM signing, `signDirect` adding the hybrid layer,
 *   `getOfflineSigner`, `signArbitrary`).
 */
export type QorexMockProfile = "current" | "planned";

export type QorexMockChainId = "qorechain-diana" | "qorechain-vladi";

export interface QorexMockOptions {
  /** BIP-39 mnemonic. Default: the public BIP-39 test mnemonic ("abandon ... about"). */
  readonly mnemonic?: string;
  /** Account index on every lane. Default 0. */
  readonly accountIndex?: number;
  /** Network selected in the mock wallet. Default `qorechain-diana`. */
  readonly chainId?: QorexMockChainId;
  /** REST endpoint of that network. Default `https://api-testnet.qore.host` (`https://api.qore.host` for mainnet). */
  readonly rest?: string;
  /** EVM JSON-RPC endpoint, used by `eth_sendTransaction` in the planned profile. Default `https://evm-testnet.qore.host` (`https://evm.qore.host` for mainnet). */
  readonly evmRpc?: string;
  /** Default `current`. */
  readonly profile?: QorexMockProfile;
  /**
   * The mock refuses to sign or broadcast for `qorechain-vladi` (mainnet)
   * unless this is true. Default false.
   */
  readonly allowMainnet?: boolean;
  /**
   * When true (default), every approval is granted unless `rejectNext()` was
   * queued. When false, each approval waits for `approveNext()` or `rejectNext()`.
   */
  readonly autoApprove?: boolean;
  /** How long `signAndBroadcast` waits for the transaction to be included. Default 30000 ms. */
  readonly inclusionTimeoutMs?: number;
  /** Poll interval while waiting for inclusion. Default 1500 ms. */
  readonly pollIntervalMs?: number;
  /** `fetch` used for REST and JSON-RPC calls. `install()` only; `initScript()` uses the page's `fetch`. */
  readonly fetch?: FetchLike;
}

export interface ResolvedOptions {
  mnemonic: string;
  accountIndex: number;
  chainId: QorexMockChainId;
  rest: string;
  evmRpc: string;
  profile: QorexMockProfile;
  allowMainnet: boolean;
  autoApprove: boolean;
  inclusionTimeoutMs: number;
  pollIntervalMs: number;
}

/** Options that survive JSON (everything except `fetch`). */
export function resolveOptions(options: QorexMockOptions = {}): ResolvedOptions {
  const chainId = options.chainId ?? "qorechain-diana";
  if (chainId !== "qorechain-diana" && chainId !== "qorechain-vladi") {
    throw new Error(`QoreX (mock): unsupported chain ${String(chainId)}`);
  }
  const profile = options.profile ?? "current";
  if (profile !== "current" && profile !== "planned") {
    throw new Error(`QoreX (mock): unknown profile ${String(profile)}`);
  }
  const accountIndex = options.accountIndex ?? 0;
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 0x7fffffff) {
    throw new Error("QoreX (mock): accountIndex must be a non-negative integer");
  }
  const mainnet = chainId === "qorechain-vladi";
  return {
    mnemonic: options.mnemonic ?? PUBLIC_TEST_MNEMONIC,
    accountIndex,
    chainId,
    rest: (options.rest ?? (mainnet ? "https://api.qore.host" : "https://api-testnet.qore.host")).replace(/\/+$/, ""),
    evmRpc: options.evmRpc ?? (mainnet ? "https://evm.qore.host" : "https://evm-testnet.qore.host"),
    profile,
    allowMainnet: options.allowMainnet === true,
    autoApprove: options.autoApprove !== false,
    inclusionTimeoutMs: options.inclusionTimeoutMs ?? 30_000,
    pollIntervalMs: options.pollIntervalMs ?? 1_500,
  };
}
