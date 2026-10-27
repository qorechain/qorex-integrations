// SPDX-License-Identifier: Apache-2.0

import { existsSync } from "node:fs";
import { QOREX_RDNS, findQorexEip1193 } from "@qorechain/qorex-types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { QOREX_MOCK_RDNS, createQorexMock, type QorexMockInjected } from "../src/index.js";
import { freshWindow } from "./helpers.js";

describe("install", () => {
  it("announces EIP-6963 as QoreX (mock) and answers every request", () => {
    const win = freshWindow();
    const seen: Array<{ info: { rdns: string; name: string; icon: string; uuid: string }; provider: unknown }> = [];
    win.addEventListener("eip6963:announceProvider", (ev) => seen.push((ev as CustomEvent).detail));
    createQorexMock().install(win);
    expect(seen).toHaveLength(1);
    win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("eip6963:requestProvider"));
    expect(seen).toHaveLength(2);
    const { info, provider } = seen[0]!;
    expect(info).toMatchObject({ rdns: QOREX_MOCK_RDNS, name: "QoreX (mock)" });
    expect(info.icon.startsWith("data:image/")).toBe(true);
    expect(provider).toBe((win as unknown as { qorex: QorexMockInjected }).qorex.evm);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it("is never taken for QoreX by rdns", () => {
    expect(QOREX_MOCK_RDNS).not.toBe(QOREX_RDNS);
    const g = globalThis as { window?: unknown; Event: typeof Event };
    const NodeEvent = g.Event;
    const win = freshWindow();
    createQorexMock().install(win);
    g.window = win;
    g.Event = (win as unknown as { Event: typeof Event }).Event;
    try {
      expect(findQorexEip1193()).toBeUndefined();
    } finally {
      delete g.window;
      g.Event = NodeEvent;
    }
  });

  it("writes window.qorex with isQoreX providers and window.__qorexMock", () => {
    const win = freshWindow();
    const control = createQorexMock({ profile: "planned" }).install(win);
    const q = (win as unknown as { qorex: QorexMockInjected }).qorex;
    expect(q.evm.isQoreX).toBe(true);
    expect(q.native.isQoreX).toBe(true);
    expect(q.svm.isQoreX).toBe(true);
    expect(win.__qorexMock).toBe(control);
    expect(control.profile).toBe("planned");
  });

  it("logs requests as JSON", async () => {
    const win = freshWindow();
    const mock = createQorexMock();
    mock.install(win);
    const q = (win as unknown as { qorex: QorexMockInjected }).qorex;
    await q.evm.request({ method: "eth_chainId" });
    await q.native.getKey("qorechain-diana");
    expect(mock.requests.map((r) => [r.method, r.outcome])).toEqual([
      ["evm:eth_chainId", "ok"],
      ["native:getKey", "ok"],
    ]);
    expect(JSON.parse(JSON.stringify(mock.requests))[1].result.pubKey).toHaveLength(33);
    mock.clearRequests();
    expect(mock.requests).toEqual([]);
  });

  it("rejects bad options", () => {
    expect(() => createQorexMock({ chainId: "cosmoshub-4" as never })).toThrow("unsupported chain");
    expect(() => createQorexMock({ profile: "future" as never })).toThrow("unknown profile");
    expect(() => createQorexMock({ accountIndex: -1 })).toThrow("accountIndex");
  });
});

const built = existsSync(new URL("../dist/inpage.global.js", import.meta.url));

describe.skipIf(!built)("initScript (needs a build)", () => {
  function page(script: string) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://dapp.example/", runScripts: "outside-only" });
    dom.window.eval(script);
    return dom.window as unknown as Window & { qorex: QorexMockInjected };
  }

  it("is a self-contained script that installs the mock with the options", async () => {
    const script = createQorexMock({ profile: "planned", accountIndex: 1 }).initScript();
    expect(script).not.toMatch(/\bimport\s*\(|\brequire\(/);
    const win = page(script);
    expect(win.__qorexMock?.profile).toBe("planned");
    expect(await win.qorex.evm.request({ method: "eth_requestAccounts" })).toEqual(["0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0"]);
    const sig = await win.qorex.evm.request({ method: "personal_sign", params: ["0x68656c6c6f", "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0"] });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("does not install twice in one page", () => {
    const script = createQorexMock().initScript();
    const win = page(script);
    const first = win.__qorexMock;
    (win as unknown as { eval(s: string): void }).eval(script);
    expect(win.__qorexMock).toBe(first);
  });
});
