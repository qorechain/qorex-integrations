// SPDX-License-Identifier: Apache-2.0
//
// Detection helpers. All of them return `undefined` / `false` outside a browser.

import { QOREX_RDNS } from "./constants.js";
import type {
  Eip6963ProviderDetail,
  QorexEip1193Provider,
  QorexInjected,
  QorexNativeCapability,
  QorexNativeProvider,
} from "./providers.js";

const ANNOUNCE = "eip6963:announceProvider";
const REQUEST = "eip6963:requestProvider";

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.addEventListener === "function";
}

function qorexDetail(event: Event): QorexEip1193Provider | undefined {
  const detail = (event as CustomEvent<Eip6963ProviderDetail | undefined>).detail;
  if (!detail || typeof detail !== "object") return undefined;
  if (detail.info?.rdns !== QOREX_RDNS) return undefined;
  const provider = detail.provider as Partial<QorexEip1193Provider> | undefined;
  if (!provider || typeof provider.request !== "function") return undefined;
  return provider as QorexEip1193Provider;
}

export interface DiscoverQorexEip1193Options {
  /** How long to wait for the announcement, in milliseconds. Default 500. */
  readonly timeoutMs?: number;
}

/**
 * Finds the QoreX EIP-1193 provider through EIP-6963: listens for
 * `eip6963:announceProvider`, dispatches `eip6963:requestProvider`, and
 * resolves with the provider whose `info.rdns` is `network.qore.qorex`.
 * Other wallets' announcements are ignored. Resolves `undefined` after
 * `timeoutMs` or outside a browser.
 *
 * EIP-6963 announcements are not authenticated: any extension can claim an
 * rdns. Treat the result as "a provider that says it is QoreX".
 */
export function discoverQorexEip1193(options: DiscoverQorexEip1193Options = {}): Promise<QorexEip1193Provider | undefined> {
  if (!hasWindow()) return Promise.resolve(undefined);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 500);
  return new Promise((resolve) => {
    const onAnnounce = (event: Event): void => {
      const provider = qorexDetail(event);
      if (provider) finish(provider);
    };
    const finish = (provider: QorexEip1193Provider | undefined): void => {
      window.removeEventListener(ANNOUNCE, onAnnounce);
      clearTimeout(timer);
      resolve(provider);
    };
    window.addEventListener(ANNOUNCE, onAnnounce);
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    window.dispatchEvent(new Event(REQUEST));
  });
}

/**
 * Synchronous EIP-6963 probe: dispatches `eip6963:requestProvider` and
 * returns the QoreX provider if it was announced during the dispatch. QoreX
 * announces synchronously, so this finds an installed QoreX without waiting.
 * Wallets that announce later are not seen; use `discoverQorexEip1193` when
 * waiting is acceptable.
 */
export function findQorexEip1193(): QorexEip1193Provider | undefined {
  if (!hasWindow()) return undefined;
  let found: QorexEip1193Provider | undefined;
  const onAnnounce = (event: Event): void => {
    found ??= qorexDetail(event);
  };
  window.addEventListener(ANNOUNCE, onAnnounce);
  try {
    window.dispatchEvent(new Event(REQUEST));
  } finally {
    window.removeEventListener(ANNOUNCE, onAnnounce);
  }
  return found;
}

function injected(): Partial<QorexInjected> | undefined {
  if (!hasWindow()) return undefined;
  const q = (window as { qorex?: unknown }).qorex;
  return q && typeof q === "object" ? (q as Partial<QorexInjected>) : undefined;
}

/** `window.qorex.native` when it looks like the QoreX native provider, otherwise `undefined`. */
export function getQorexNative(): QorexNativeProvider | undefined {
  const native = injected()?.native as Partial<QorexNativeProvider> | undefined;
  if (!native || typeof native.getKey !== "function" || typeof native.signDirect !== "function") return undefined;
  return native as QorexNativeProvider;
}

/** True when QoreX has injected `window.qorex` with an EVM or native provider. */
export function isQorexInstalled(): boolean {
  const q = injected();
  if (!q) return false;
  return getQorexNative() !== undefined || typeof (q.evm as Partial<QorexEip1193Provider> | undefined)?.request === "function";
}

/** True when the native provider declares `capability` in `capabilities`. */
export function hasCapability(
  native: Pick<QorexNativeProvider, "capabilities"> | undefined | null,
  capability: QorexNativeCapability | (string & {}),
): boolean {
  const caps = native?.capabilities;
  return Array.isArray(caps) && caps.includes(capability);
}
