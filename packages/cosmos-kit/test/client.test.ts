// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import {
  QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER,
  QorexClient,
  QorexExtensionWallet,
  isQorexIntegrationError,
  qorexExtension,
  qorexExtensionInfo,
  qorexSignAndBroadcast,
  wallets,
} from "../src/index.js";
import { ADDRESS, BECH32, PUBKEY, installFakeQorex, signDoc } from "./fake-qorex.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function client(options?: Parameters<typeof installFakeQorex>[0]) {
  const fake = installFakeQorex(options);
  cleanups.push(fake.uninstall);
  return { fake, client: new QorexClient(fake.native) };
}

describe("wallet info", () => {
  it("describes the QoreX extension", () => {
    expect(qorexExtensionInfo.name).toBe("qorex-extension");
    expect(qorexExtensionInfo.prettyName).toBe("QoreX");
    expect(qorexExtensionInfo.mode).toBe("extension");
    expect(String(qorexExtensionInfo.logo)).toMatch(/^data:image\/png;base64,/);
    expect(qorexExtensionInfo.downloads?.some((d) => d.browser === "chrome")).toBe(true);
    expect(qorexExtension).toBeInstanceOf(QorexExtensionWallet);
    expect(wallets).toEqual([qorexExtension]);
  });

  it("finds QoreX when the client is initialised", async () => {
    const fake = installFakeQorex();
    cleanups.push(fake.uninstall);
    const w = new QorexExtensionWallet(qorexExtensionInfo);
    await w.initClient();
    expect(w.client).toBeInstanceOf(QorexClient);
  });

  it("reports no client without QoreX", async () => {
    const w = new QorexExtensionWallet(qorexExtensionInfo);
    await w.initClient();
    expect(w.client).toBeUndefined();
  });
});

describe("enable and getKey", () => {
  it("converts number[] bytes to Uint8Array", async () => {
    const { client: c, fake } = client();
    await c.enable(["qorechain-diana", "qorechain-vladi"]);
    expect(fake.calls.filter((x) => x.method === "enable").map((x) => x.args[0])).toEqual(["qorechain-diana", "qorechain-vladi"]);

    const key = await c.getKey("qorechain-diana");
    expect(key.pubKey).toBeInstanceOf(Uint8Array);
    expect(key.address).toBeInstanceOf(Uint8Array);
    expect([...key.pubKey]).toEqual(PUBKEY);
    expect([...key.address]).toEqual(ADDRESS);
    expect(key.bech32Address).toBe(BECH32);
    expect(key.algo).toBe("secp256k1");
    expect(key.isNanoLedger).toBe(false);

    const account = await c.getAccount("qorechain-diana");
    expect(account.pubkey).toBeInstanceOf(Uint8Array);
    expect(account.address).toBe(BECH32);
    expect(await c.getSimpleAccount("qorechain-diana")).toEqual({
      namespace: "cosmos",
      chainId: "qorechain-diana",
      address: BECH32,
      username: "QoreX",
    });
  });

  it("passes QoreX's chain refusal through", async () => {
    const { client: c } = client();
    await expect(c.getKey("cosmoshub-4")).rejects.toThrow("QoreX: unsupported chain cosmoshub-4");
  });
});

describe("offline signer", () => {
  it("refuses a signer-based transaction on QoreChain with QOREX_USE_SIGN_AND_BROADCAST", async () => {
    for (const chainId of ["qorechain-vladi", "qorechain-diana"]) {
      const { client: c, fake } = client();
      const signer = c.getOfflineSigner(chainId, "direct");
      expect((await signer.getAccounts())[0]?.address).toBe(BECH32);
      const err = await signer.signDirect(BECH32, signDoc(chainId)).catch((e: unknown) => e);
      expect(isQorexIntegrationError(err, "QOREX_USE_SIGN_AND_BROADCAST")).toBe(true);
      expect((err as Error).message).toMatch(/signAndBroadcast/);
      expect(fake.calls.some((x) => x.method === "signDirect")).toBe(false);
      fake.uninstall();
    }
  });

  it("also refuses when the SignDoc names a QoreChain chain id", async () => {
    const { client: c } = client({ supportedChains: ["qorechain-vladi", "qorechain-diana", "testchain-1"] });
    const signer = c.getOfflineSignerDirect("testchain-1");
    const err = await signer.signDirect(BECH32, signDoc("qorechain-vladi")).catch((e: unknown) => e);
    expect(isQorexIntegrationError(err, "QOREX_USE_SIGN_AND_BROADCAST")).toBe(true);
  });

  it("signs on another chain id and returns cosmjs types", async () => {
    const { client: c, fake } = client({ supportedChains: ["testchain-1"] });
    const signer = c.getOfflineSigner("testchain-1");
    const res = await signer.signDirect(BECH32, signDoc("testchain-1"));
    expect(res.signed.bodyBytes).toBeInstanceOf(Uint8Array);
    expect([...res.signed.authInfoBytes]).toEqual([18, 3, 4]);
    expect(res.signed.accountNumber).toBe(7n);
    expect(res.signature.signature).toBe("c2ln");
    const sent = fake.calls.find((x) => x.method === "signDirect")!.args[1] as Record<string, unknown>;
    expect(sent.accountNumber).toBe("7");
    expect(Array.isArray(sent.bodyBytes)).toBe(true);
  });

  it("uses QoreX's signed document on QoreChain once QoreX declares signDirectAddsPqcLayer", async () => {
    const { client: c } = client({
      capabilities: ["signAndBroadcast", QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER],
      rewriteAuthInfo: () => [18, 9, 9, 9],
    });
    const res = await c.getOfflineSignerDirect("qorechain-diana").signDirect(BECH32, signDoc("qorechain-diana"));
    expect([...res.signed.authInfoBytes]).toEqual([18, 9, 9, 9]);
  });
});

describe("refusals", () => {
  it("refuses Amino by design", async () => {
    const { client: c } = client();
    expect(() => c.getOfflineSignerAmino("qorechain-diana")).toThrow(/QOREX_AMINO_REFUSED/);
    const err = await c.signAmino().catch((e: unknown) => e);
    expect(isQorexIntegrationError(err, "QOREX_AMINO_REFUSED")).toBe(true);
    expect((err as Error).message).toMatch(/Amino JSON cannot carry the hybrid ML-DSA-87 signature/);
  });

  it("reports signArbitrary as not supported yet, without calling QoreX", async () => {
    const { client: c, fake } = client();
    const err = await c.signArbitrary("qorechain-diana", BECH32, "hello").catch((e: unknown) => e);
    expect(isQorexIntegrationError(err, "QOREX_NOT_SUPPORTED_YET")).toBe(true);
    expect(fake.calls.some((x) => x.method === "signArbitrary")).toBe(false);
  });
});

describe("signAndBroadcast", () => {
  const request = {
    chainId: "qorechain-diana",
    messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: new Uint8Array([1, 2, 3]) }],
    memo: "m",
    gasLimit: 200_000,
  };

  it("passes the messages through and returns txHash, code, height and shield", async () => {
    const { client: c, fake } = client();
    expect(await c.signAndBroadcast(request)).toEqual({ txHash: "ABCDEF", code: 0, height: 42, shield: "shielded" });
    expect(fake.calls.find((x) => x.method === "signAndBroadcast")!.args[0]).toBe(request);
  });

  it("uses window.qorex.native by default", async () => {
    const fake = installFakeQorex();
    cleanups.push(fake.uninstall);
    const res = await qorexSignAndBroadcast(request);
    expect(res.txHash).toBe("ABCDEF");
    expect(fake.calls.at(-1)!.args[0]).toBe(request);
  });

  it("throws QOREX_NOT_INSTALLED without QoreX", async () => {
    const err = await qorexSignAndBroadcast(request).catch((e: unknown) => e);
    expect(isQorexIntegrationError(err, "QOREX_NOT_INSTALLED")).toBe(true);
  });
});

describe("addChain", () => {
  it("accepts QoreChain and surfaces QoreX's refusal for other chains", async () => {
    const { client: c } = client();
    await c.addChain({ name: "qorechaintestnet", chain: { chain_id: "qorechain-diana", chain_name: "qorechaintestnet" } } as never);
    await expect(c.addChain({ name: "cosmoshub", chain: { chain_id: "cosmoshub-4" } } as never)).rejects.toMatchObject({ code: 4902 });
  });
});
