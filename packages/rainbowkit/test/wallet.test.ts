// SPDX-License-Identifier: Apache-2.0

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { afterEach, describe, expect, it } from "vitest";
import { createConfig, http } from "wagmi";
import { connect, disconnect, getAccount } from "wagmi/actions";
import { QOREX_CHAINS, QOREX_RDNS, qorechain, qorechainTestnet, qorexWallet } from "../src/index.js";
import { installFakeQorex, installWindowEthereum } from "./fake-qorex.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  window.localStorage?.clear();
});

function setup(walletFn: Parameters<typeof connectorsForWallets>[0][number]["wallets"][number] = qorexWallet) {
  const connectors = connectorsForWallets([{ groupName: "Recommended", wallets: [walletFn] }], {
    appName: "test",
    projectId: "test",
  });
  const config = createConfig({
    chains: QOREX_CHAINS,
    connectors,
    transports: { [qorechain.id]: http(), [qorechainTestnet.id]: http() },
  });
  const qorex = config.connectors.find((c) => c.id === "qorex");
  if (!qorex) throw new Error("qorex connector missing");
  return { config, connector: qorex };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("qorexWallet", () => {
  it("describes QoreX for RainbowKit", () => {
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    const w = qorexWallet();
    expect(w.id).toBe("qorex");
    expect(w.name).toBe("QoreX");
    expect(w.rdns).toBe("network.qore.qorex");
    expect(w.rdns).toBe(QOREX_RDNS);
    expect(typeof w.iconUrl === "string" && w.iconUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(w.iconBackground).toMatch(/^#[0-9A-F]{6}$/i);
    expect(w.installed).toBe(true);
    expect(w.downloadUrls?.chrome).toMatch(/^https:\/\/chromewebstore\.google\.com\//);
    expect(w.downloadUrls?.firefox).toMatch(/^https:\/\/addons\.mozilla\.org\//);
    expect(w.downloadUrls?.android).toMatch(/^https:\/\/play\.google\.com\//);
    expect(w.downloadUrls?.ios).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(w.extension?.instructions?.steps.map((s) => s.step)).toEqual(["install", "create", "refresh"]);
    expect(typeof w.createConnector).toBe("function");
  });

  it("reports not installed without QoreX, even with another wallet on window.ethereum", () => {
    const eth = installWindowEthereum();
    cleanups.push(eth.uninstall);
    expect(qorexWallet().installed).toBe(false);
  });
});

describe("QOREX_CHAINS", () => {
  it("defines mainnet and testnet", () => {
    expect(qorechain.id).toBe(9801);
    expect(qorechainTestnet.id).toBe(9800);
    expect(qorechain.rpcUrls.default.http[0]).toBe("https://evm.qore.host");
    expect(qorechainTestnet.rpcUrls.default.http[0]).toBe("https://evm-testnet.qore.host");
    expect(qorechain.nativeCurrency).toEqual({ name: "QOR", symbol: "QOR", decimals: 18 });
    expect(qorechain.blockExplorers?.default.url).toBe("https://explore.qore.network");
    expect(qorechainTestnet.testnet).toBe(true);
  });
});

describe("QoreX connector", () => {
  it("routes requests to the QoreX provider and never to window.ethereum", async () => {
    const eth = installWindowEthereum();
    const q = installFakeQorex();
    cleanups.push(eth.uninstall, q.uninstall);
    const { config, connector } = setup();

    expect(connector.rdns).toBe(QOREX_RDNS);
    // The EIP-6963 announcement of QoreX is merged into this connector, not added twice.
    expect(config.connectors.filter((c) => c.id === QOREX_RDNS || c.rdns === QOREX_RDNS)).toHaveLength(1);

    const result = await connect(config, { connector });
    expect(result.chainId).toBe(9801);
    expect(result.accounts[0]?.toLowerCase()).toBe(q.state.address);
    expect(q.methods).toContain("eth_requestAccounts");
    expect(q.methods).toContain("eth_chainId");
    expect(eth.calls).toEqual([]);
    expect(await connector.getProvider()).toBe(q.evm);
  });

  it("fails with ProviderNotFoundError when QoreX is absent", async () => {
    const eth = installWindowEthereum();
    cleanups.push(eth.uninstall);
    const { config, connector } = setup();
    await expect(connect(config, { connector })).rejects.toThrow(/Provider not found/i);
    expect(eth.calls).toEqual([]);
  });

  it("does not watch focus unless asked", async () => {
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    const { config, connector } = setup();
    await connect(config, { connector });
    q.state.address = "0x2222222222222222222222222222222222222222";
    window.dispatchEvent(new Event("focus"));
    await tick();
    expect(getAccount(config).address?.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");
  });

  it("pollAccountsOnFocus reports account and chain changes", async () => {
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    const { config, connector } = setup(() => qorexWallet({ pollAccountsOnFocus: true }));
    await connect(config, { connector });
    expect(getAccount(config).chainId).toBe(9801);

    q.state.address = "0x2222222222222222222222222222222222222222";
    q.state.chainHex = "0x2648";
    window.dispatchEvent(new Event("focus"));
    await tick();
    await tick();
    expect(getAccount(config).address?.toLowerCase()).toBe("0x2222222222222222222222222222222222222222");
    expect(getAccount(config).chainId).toBe(9800);
  });

  it("pollAccountsOnFocus disconnects when the wallet is locked, and stops after disconnect", async () => {
    const q = installFakeQorex();
    cleanups.push(q.uninstall);
    const { config, connector } = setup(() => qorexWallet({ pollAccountsOnFocus: true }));
    await connect(config, { connector });

    q.state.unlocked = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    await tick();
    expect(getAccount(config).status).toBe("disconnected");

    q.state.unlocked = true;
    await connect(config, { connector });
    await disconnect(config, { connector });
    const before = q.methods.length;
    window.dispatchEvent(new Event("focus"));
    await tick();
    expect(q.methods.slice(before)).not.toContain("eth_accounts");
  });
});
