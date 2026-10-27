// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QOREX_RDNS,
  discoverQorexEip1193,
  findQorexEip1193,
  getQorexNative,
  hasCapability,
  isQoreChainChainId,
  isQorexInstalled,
  isQorexIntegrationError,
  QorexIntegrationError,
} from "../src/index.js";
import { QOREX_ICON_DATA_URI } from "../src/icon.js";
import { installFakeQorex, installOtherWallet } from "./fake-qorex.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

describe("discoverQorexEip1193", () => {
  it("picks QoreX by rdns and ignores other wallets", async () => {
    const before = installOtherWallet("io.metamask", "MetaMask");
    const q = installFakeQorex();
    const after = installOtherWallet("app.phantom", "Phantom");
    cleanups.push(before.uninstall, q.uninstall, after.uninstall);

    const provider = await discoverQorexEip1193({ timeoutMs: 50 });
    expect(provider).toBe(q.injected.evm);
    expect(provider?.isQoreX).toBe(true);
  });

  it("ignores a provider announced under a different rdns even if it claims to be QoreX", async () => {
    const other = installOtherWallet("network.qore.qorex.mock", "QoreX");
    cleanups.push(other.uninstall);
    expect(await discoverQorexEip1193({ timeoutMs: 10 })).toBeUndefined();
  });

  it("resolves undefined after the timeout when QoreX is absent", async () => {
    vi.useFakeTimers();
    const other = installOtherWallet("io.metamask");
    cleanups.push(other.uninstall);
    const pending = discoverQorexEip1193({ timeoutMs: 250 });
    await vi.advanceTimersByTimeAsync(249);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeUndefined();
  });

  it("finds a wallet that announces after the request", async () => {
    const provider = { isQoreX: true, request: async () => null, on() {}, removeListener() {} };
    const p = discoverQorexEip1193({ timeoutMs: 200 });
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { info: { uuid: "u", name: "QoreX", icon: QOREX_ICON_DATA_URI, rdns: QOREX_RDNS }, provider },
        }),
      );
    }, 5);
    expect(await p).toBe(provider);
  });

  it("does not leave listeners behind", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    await discoverQorexEip1193({ timeoutMs: 0 });
    const added = add.mock.calls.filter((c) => c[0] === "eip6963:announceProvider").length;
    const removed = remove.mock.calls.filter((c) => c[0] === "eip6963:announceProvider").length;
    expect(added).toBe(removed);
  });
});

describe("findQorexEip1193", () => {
  it("returns the provider synchronously", () => {
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    expect(findQorexEip1193()).toBe(q.injected.evm);
  });

  it("returns undefined without QoreX", () => {
    const other = installOtherWallet("io.metamask");
    cleanups.push(other.uninstall);
    expect(findQorexEip1193()).toBeUndefined();
  });
});

describe("window.qorex helpers", () => {
  it("detects the native provider", () => {
    expect(isQorexInstalled()).toBe(false);
    expect(getQorexNative()).toBeUndefined();
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    expect(isQorexInstalled()).toBe(true);
    expect(getQorexNative()).toBe(q.injected.native);
  });

  it("rejects a window.qorex without the native methods", () => {
    (window as unknown as { qorex: unknown }).qorex = { native: { getKey: 1 } };
    cleanups.push(() => delete window.qorex);
    expect(getQorexNative()).toBeUndefined();
    expect(isQorexInstalled()).toBe(false);
  });

  it("hasCapability reads the declared list", () => {
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    expect(hasCapability(q.injected.native, "signAndBroadcast")).toBe(true);
    expect(hasCapability(q.injected.native, "somethingElse")).toBe(false);
    expect(hasCapability(undefined, "signAndBroadcast")).toBe(false);
    expect(hasCapability({ capabilities: undefined as unknown as string[] }, "listAccounts")).toBe(false);
  });
});

describe("constants and errors", () => {
  it("knows the QoreChain chain ids", () => {
    expect(isQoreChainChainId("qorechain-vladi")).toBe(true);
    expect(isQoreChainChainId("qorechain-diana")).toBe(true);
    expect(isQoreChainChainId("cosmoshub-4")).toBe(false);
  });

  it("error guard matches by name and code", () => {
    const e = new QorexIntegrationError("QOREX_AMINO_REFUSED", "x");
    expect(isQorexIntegrationError(e)).toBe(true);
    expect(isQorexIntegrationError(e, "QOREX_AMINO_REFUSED")).toBe(true);
    expect(isQorexIntegrationError(e, "QOREX_NOT_INSTALLED")).toBe(false);
    expect(isQorexIntegrationError(new Error("x"))).toBe(false);
  });

  it("icon is a PNG data URI", () => {
    expect(QOREX_ICON_DATA_URI.startsWith("data:image/png;base64,iVBOR")).toBe(true);
  });
});
