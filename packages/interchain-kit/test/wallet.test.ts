// SPDX-License-Identifier: Apache-2.0

import { ExtensionWallet } from "@interchain-kit/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER,
  QorexCosmosWallet,
  createQorexWallet,
  isQorexIntegrationError,
  qorexExtensionInfo,
  qorexSignAndBroadcast,
  qorexWallet,
} from "../src/index.js";
import { ADDRESS, BECH32, PUBKEY, installFakeQorex, signDoc } from "./fake-qorex.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function cosmos(options?: Parameters<typeof installFakeQorex>[0]) {
  const fake = installFakeQorex(options);
  cleanups.push(fake.uninstall);
  const wallet = createQorexWallet();
  await wallet.init();
  const cw = wallet.getWalletByChainType("cosmos") as QorexCosmosWallet;
  return { fake, wallet, cw };
}

describe("wallet info", () => {
  it("describes the QoreX extension", () => {
    expect(qorexExtensionInfo.name).toBe("qorex-extension");
    expect(qorexExtensionInfo.prettyName).toBe("QoreX");
    expect(qorexExtensionInfo.mode).toBe("extension");
    expect(qorexExtensionInfo.windowKey).toBe("qorex");
    expect(qorexExtensionInfo.cosmosKey).toBe("qorex.native");
    expect(String(qorexExtensionInfo.logo)).toMatch(/^data:image\/png;base64,/);
    expect(qorexExtensionInfo.downloads?.some((d) => d.browser === "firefox")).toBe(true);
    expect(qorexWallet).toBeInstanceOf(ExtensionWallet);
  });

  it("init binds window.qorex.native", async () => {
    const { fake, cw } = await cosmos();
    expect(cw).toBeInstanceOf(QorexCosmosWallet);
    expect(cw.client).toBe(fake.native);
  });

  it("init fails without QoreX", async () => {
    await expect(createQorexWallet().init()).rejects.toThrow();
  });
});

describe("connect and getAccount", () => {
  it("enables the chain and converts number[] bytes to Uint8Array", async () => {
    const { fake, wallet, cw } = await cosmos();
    wallet.setChainMap([{ chainId: "qorechain-diana", chainName: "qorechaintestnet", chainType: "cosmos" } as never]);
    await wallet.connect("qorechain-diana");
    expect(fake.calls.find((c) => c.method === "enable")?.args).toEqual(["qorechain-diana"]);

    const key = await cw.getKey("qorechain-diana");
    expect(key.pubKey).toBeInstanceOf(Uint8Array);
    expect([...key.pubKey]).toEqual(PUBKEY);
    expect([...key.address]).toEqual(ADDRESS);

    const account = await wallet.getAccount("qorechain-diana");
    expect(account.address).toBe(BECH32);
    expect(account.pubkey).toBeInstanceOf(Uint8Array);
    expect(account.algo).toBe("secp256k1");
    expect(account.isNanoLedger).toBe(false);
  });
});

describe("offline signer", () => {
  it("refuses a signer-based transaction on QoreChain with QOREX_USE_SIGN_AND_BROADCAST", async () => {
    const { fake, cw } = await cosmos();
    for (const chainId of ["qorechain-vladi", "qorechain-diana"]) {
      const signer = await cw.getOfflineSigner(chainId);
      const err = await signer.signDirect(BECH32, signDoc(chainId)).catch((e: unknown) => e);
      expect(isQorexIntegrationError(err, "QOREX_USE_SIGN_AND_BROADCAST")).toBe(true);
    }
    expect(fake.calls.some((c) => c.method === "signDirect")).toBe(false);
  });

  it("signs on another chain id", async () => {
    const { fake, cw } = await cosmos({ supportedChains: ["testchain-1"] });
    const signer = await cw.getOfflineSigner("testchain-1");
    expect((await signer.getAccounts())[0]?.address).toBe(BECH32);
    const res = await signer.signDirect(BECH32, signDoc("testchain-1"));
    expect(res.signed.authInfoBytes).toBeInstanceOf(Uint8Array);
    expect(res.signed.accountNumber).toBe(7n);
    const sent = fake.calls.find((c) => c.method === "signDirect")!.args[1] as Record<string, unknown>;
    expect(sent.accountNumber).toBe("7");
  });

  it("returns QoreX's signed document once QoreX declares signDirectAddsPqcLayer", async () => {
    const { cw } = await cosmos({
      capabilities: ["signAndBroadcast", QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER],
      rewriteAuthInfo: () => [18, 9, 9, 9],
    });
    const signer = await cw.getOfflineSigner("qorechain-vladi");
    const res = await signer.signDirect(BECH32, signDoc("qorechain-vladi"));
    expect([...res.signed.authInfoBytes]).toEqual([18, 9, 9, 9]);
  });
});

describe("refusals", () => {
  it("refuses Amino by design", async () => {
    const { cw } = await cosmos();
    const err = await cw.signAmino().catch((e: unknown) => e);
    expect(isQorexIntegrationError(err, "QOREX_AMINO_REFUSED")).toBe(true);
    expect((err as Error).message).toMatch(/Amino JSON cannot carry the hybrid ML-DSA-87 signature/);
  });

  it("reports signArbitrary and sendTx as not supported yet", async () => {
    const { cw, fake } = await cosmos();
    expect(isQorexIntegrationError(await cw.signArbitrary().catch((e: unknown) => e), "QOREX_NOT_SUPPORTED_YET")).toBe(true);
    expect(isQorexIntegrationError(await cw.sendTx().catch((e: unknown) => e), "QOREX_NOT_SUPPORTED_YET")).toBe(true);
    expect(fake.calls.some((c) => c.method === "signArbitrary")).toBe(false);
  });
});

describe("signAndBroadcast", () => {
  it("passes the messages through", async () => {
    const { cw, fake } = await cosmos();
    const request = {
      chainId: "qorechain-vladi",
      messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: "CgEx" }],
    };
    expect(await cw.signAndBroadcast(request)).toEqual({ txHash: "ABCDEF", code: 0, height: 42, shield: "shielded" });
    expect(fake.calls.find((c) => c.method === "signAndBroadcast")!.args[0]).toBe(request);
    expect((await qorexSignAndBroadcast(request)).shield).toBe("shielded");
  });
});
