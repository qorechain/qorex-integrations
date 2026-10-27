// SPDX-License-Identifier: Apache-2.0

import {
  addressFromPublicKey,
  decodeTxRaw,
  deriveCanonicalPqKey,
  deriveClassicalKey,
  encodeTxRaw,
  fromBase64,
  pqcLayers,
  signPqLayer,
  verifyHybridTx,
  verifyMessage,
} from "@qorechain/qoresign";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_TEST_MNEMONIC,
  createQorexMock,
  raiseGasForLayer,
  type QorexMockNativeProvider,
  type QorexMockOptions,
} from "../src/index.js";
import { encodeAuthInfo, encodeTxBody, lenField, readAuthInfoFee, stringField, concat } from "../src/proto.js";
import { chainStub, freshWindow, rejection } from "./helpers.js";

const classical = deriveClassicalKey({ mnemonic: PUBLIC_TEST_MNEMONIC });
const ADDRESS = addressFromPublicKey(classical.publicKey, "secp256k1").bech32;
const pq = deriveCanonicalPqKey({ mnemonic: PUBLIC_TEST_MNEMONIC, address: ADDRESS });

function msgSend(from: string, to: string, amount: string) {
  const coin = concat(stringField(1, "uqor"), stringField(2, amount));
  return {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: concat(stringField(1, from), stringField(2, to), lenField(3, coin)),
  };
}

function setup(options: QorexMockOptions = {}, registered: Uint8Array | null = pq.publicKey) {
  const stub = chainStub({ registered: registered ?? undefined, pqPublicKey: pq.publicKey });
  const mock = createQorexMock({ fetch: stub.fetch, pollIntervalMs: 1, inclusionTimeoutMs: 50, ...options });
  const win = freshWindow();
  mock.install(win);
  const native = (win as unknown as { qorex: { native: QorexMockNativeProvider } }).qorex.native;
  return { mock, native, stub };
}

function signDoc(gasLimit: bigint, withLayer: boolean) {
  let bodyBytes = encodeTxBody([msgSend(ADDRESS, ADDRESS, "1")], "doc");
  const authInfoBytes = encodeAuthInfo({
    publicKey: classical.publicKey,
    sequence: 3n,
    fee: [{ denom: "uqor", amount: "100" }],
    gasLimit,
  });
  if (withLayer) bodyBytes = signPqLayer({ chainId: "qorechain-diana", bodyBytes, authInfoBytes, pqKey: pq }).bodyBytes;
  return { bodyBytes, authInfoBytes, chainId: "qorechain-diana", accountNumber: "42" };
}

describe.each(["current", "planned"] as const)("native, %s profile", (profile) => {
  it("getKey returns the Keplr-shaped key of the test account", async () => {
    const { native } = setup({ profile });
    const key = await native.getKey("qorechain-diana");
    expect(key.bech32Address).toBe(ADDRESS);
    expect(key.bech32Address.startsWith("qor1")).toBe(true);
    expect(key.pubKey).toEqual(Array.from(classical.publicKey));
    expect(key.address).toHaveLength(20);
    expect(key).toMatchObject({ name: "QoreX", algo: "secp256k1", isNanoLedger: false });
  });

  it("refuses chain ids QoreX does not serve", async () => {
    const { native } = setup({ profile });
    expect((await rejection(native.enable("cosmoshub-4"))).message).toBe("QoreX: unsupported chain cosmoshub-4");
    expect((await rejection(native.getKey("cosmoshub-4"))).message).toBe("QoreX: unsupported chain cosmoshub-4");
  });

  it("signAndBroadcast signs hybrid, broadcasts and reads the layer back", async () => {
    const { native, stub } = setup({ profile });
    const res = await native.signAndBroadcast({
      chainId: "qorechain-diana",
      messages: [msgSend(ADDRESS, ADDRESS, "1")],
      memo: "mock test",
    });
    expect(res).toMatchObject({ code: 0, height: 1234, shield: "shielded" });
    expect(stub.txs).toHaveLength(1);
    const tx = stub.txs[0]!;
    expect(res.txHash).toBe(tx.hash);
    const check = verifyHybridTx({
      txBytes: tx.txBytes,
      chainId: "qorechain-diana",
      accountNumber: 42n,
      classicalPublicKey: classical.publicKey,
      pqPublicKey: pq.publicKey,
    });
    expect(check).toMatchObject({ valid: true, classical: true });
    expect(readAuthInfoFee(decodeTxRaw(tx.txBytes).authInfoBytes)).toMatchObject({
      gasLimit: 400_000n,
      amount: [{ denom: "uqor", amount: "60000" }],
    });
  });

  it("signAndBroadcast registers the ML-DSA-87 key first when the account has none", async () => {
    const { native, stub } = setup({ profile }, null);
    const res = await native.signAndBroadcast({ chainId: "qorechain-diana", messages: [msgSend(ADDRESS, ADDRESS, "1")] });
    expect(res.shield).toBe("shielded");
    expect(stub.txs.map((t) => t.typeUrls[0])).toEqual([
      "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
      "/cosmos.bank.v1beta1.MsgSend",
    ]);
    expect(stub.txs[0]!.hasLayer).toBe(false);
    expect(stub.txs[1]!.hasLayer).toBe(true);
  });

  it("signAndBroadcast clamps the gas hint", async () => {
    const { native, stub } = setup({ profile });
    await native.signAndBroadcast({ chainId: "qorechain-diana", messages: [msgSend(ADDRESS, ADDRESS, "1")], gasLimit: 10 });
    expect(readAuthInfoFee(decodeTxRaw(stub.txs[0]!.txBytes).authInfoBytes).gasLimit).toBe(100_000n);
  });

  it("signAndBroadcast refuses what QoreX refuses", async () => {
    const { native, stub } = setup({ profile });
    const send = msgSend(ADDRESS, ADDRESS, "1");
    expect((await rejection(native.signAndBroadcast({ chainId: "qorechain-diana", messages: [] }))).message).toBe(
      "QoreX: send between 1 and 32 messages",
    );
    expect(
      (await rejection(native.signAndBroadcast({ chainId: "qorechain-diana", messages: [send], memo: "x".repeat(257) }))).message,
    ).toBe("QoreX: the memo may be at most 256 bytes");
    expect(
      (
        await rejection(
          native.signAndBroadcast({
            chainId: "qorechain-diana",
            messages: [{ typeUrl: "/qorechain.pqc.v1.MsgRotatePQCKey", value: new Uint8Array() }],
          }),
        )
      ).message,
    ).toBe("QoreX: /qorechain.pqc.v1.MsgRotatePQCKey is managed by the wallet itself, not by a website");
    expect((await rejection(native.signAndBroadcast({ chainId: "qorechain-vladi", messages: [send] }))).message).toBe(
      "QoreX: chain qorechain-vladi does not match the active network qorechain-diana",
    );
    expect(stub.txs).toHaveLength(0);
  });

  it("signAndBroadcast reports a rejection", async () => {
    const { native, mock, stub } = setup({ profile });
    await native.enable("qorechain-diana");
    mock.rejectNext();
    const err = await rejection(native.signAndBroadcast({ chainId: "qorechain-diana", messages: [msgSend(ADDRESS, ADDRESS, "1")] }));
    expect(err.message).toBe("QoreX: signature rejected");
    expect(stub.txs).toHaveLength(0);
  });

  it("signAndBroadcast refuses mainnet unless allowMainnet", async () => {
    const refused = setup({ profile, chainId: "qorechain-vladi" });
    const err = await rejection(
      refused.native.signAndBroadcast({ chainId: "qorechain-vladi", messages: [msgSend(ADDRESS, ADDRESS, "1")] }),
    );
    expect(err.message).toBe(
      "QoreX (mock): qorechain-vladi (mainnet) is refused. Pass allowMainnet: true to createQorexMock to sign for mainnet.",
    );
    expect(refused.stub.txs).toHaveLength(0);
    const allowed = setup({ profile, chainId: "qorechain-vladi", allowMainnet: true });
    const res = await allowed.native.signAndBroadcast({ chainId: "qorechain-vladi", messages: [msgSend(ADDRESS, ADDRESS, "1")] });
    expect(res.code).toBe(0);
  });

  it("signAndBroadcast surfaces a refused broadcast", async () => {
    const { native, stub } = setup({ profile });
    stub.broadcastCode = 13;
    const err = await rejection(native.signAndBroadcast({ chainId: "qorechain-diana", messages: [msgSend(ADDRESS, ADDRESS, "1")] }));
    expect(err.message).toMatch(/^QoreX: the network refused the transaction \(code 13, sdk\)/);
  });

  it("signDirect co-signs a SignDoc that already carries a valid layer", async () => {
    const { native } = setup({ profile });
    const doc = signDoc(500_000n, true);
    const res = await native.signDirect(ADDRESS, doc);
    expect(res.signed.authInfoBytes).toEqual(Array.from(doc.authInfoBytes));
    expect(res.signed.bodyBytes).toEqual(Array.from(doc.bodyBytes));
    const txBytes = encodeTxRaw({
      bodyBytes: Uint8Array.from(res.signed.bodyBytes),
      authInfoBytes: Uint8Array.from(res.signed.authInfoBytes),
      signatures: [fromBase64(res.signature.signature)],
    });
    expect(
      verifyHybridTx({ txBytes, chainId: "qorechain-diana", accountNumber: 42n, classicalPublicKey: classical.publicKey, pqPublicKey: pq.publicKey })
        .valid,
    ).toBe(true);
  });

  it("signDirect refuses a layer that does not verify against the registered key", async () => {
    const { native } = setup({ profile });
    const doc = signDoc(500_000n, true);
    const tampered = { ...doc, authInfoBytes: encodeAuthInfo({ publicKey: classical.publicKey, sequence: 4n, fee: [], gasLimit: 500_000n }) };
    const err = await rejection(native.signDirect(ADDRESS, tampered));
    expect(err.message).toMatch(/^QoreX refused to sign: /);
  });

  it("signDirect checks the signer and the active network", async () => {
    const { native } = setup({ profile });
    expect((await rejection(native.signDirect("qor1notme", signDoc(500_000n, true)))).message).toBe("QoreX: unknown signer address");
    const other = { ...signDoc(500_000n, true), chainId: "qorechain-vladi" };
    expect((await rejection(native.signDirect(ADDRESS, other))).message).toBe(
      "QoreX: signature chain qorechain-vladi does not match the active network qorechain-diana",
    );
  });

  it("listAccounts lists the wallet's accounts", async () => {
    const { native } = setup({ profile, accountIndex: 1 });
    const list = await native.listAccounts();
    expect(list.activeIndex).toBe(1);
    expect(list.accounts.map((a) => a.index)).toEqual([0, 1]);
    expect(list.accounts[0]!.address).toBe(ADDRESS);
  });

  it("experimentalSuggestChain accepts QoreChain chains only", async () => {
    const { native } = setup({ profile });
    expect(await native.experimentalSuggestChain({ chainId: "qorechain-diana" })).toBeNull();
    const err = await rejection(native.experimentalSuggestChain({ chainId: "osmosis-1" }));
    expect(err.code).toBe(4902);
  });

  it("dashboard-only methods are refused", async () => {
    const { native } = setup({ profile });
    expect((await rejection(native.connectProof("abcdefgh12"))).message).toBe(
      "QoreX: this method is available to the QoreChain dashboard only",
    );
  });
});

describe("native, current profile", () => {
  it("declares QoreX's capabilities and no getOfflineSigner", () => {
    const { native } = setup();
    expect(native.capabilities).toEqual(["listAccounts", "connectProofPicksAccount", "executeRequest", "signAndBroadcast"]);
    expect(native.getOfflineSigner).toBeUndefined();
  });

  it("signDirect without the hybrid layer is refused", async () => {
    const { native } = setup();
    const err = await rejection(native.signDirect(ADDRESS, signDoc(200_000n, false)));
    expect(err.message).toMatch(/^QoreX refused to sign: this app must add QoreChain's hybrid ML-DSA-87 layer/);
  });

  it("signArbitrary is refused", async () => {
    const { native } = setup();
    expect((await rejection(native.signArbitrary("qorechain-diana", ADDRESS, "hello"))).message).toBe(
      "QoreX: signArbitrary not yet supported",
    );
  });
});

describe("native, planned profile", () => {
  it("declares signDirectAddsPqcLayer", () => {
    const { native } = setup({ profile: "planned" });
    expect(native.capabilities).toContain("signDirectAddsPqcLayer");
  });

  it("signDirect adds the layer and raises a low gas limit", async () => {
    const { native } = setup({ profile: "planned" });
    const doc = signDoc(200_000n, false);
    const res = await native.signDirect(ADDRESS, doc);
    const authInfoBytes = Uint8Array.from(res.signed.authInfoBytes);
    expect(authInfoBytes).not.toEqual(doc.authInfoBytes);
    expect(readAuthInfoFee(authInfoBytes)).toMatchObject({ gasLimit: 400_000n, amount: [{ denom: "uqor", amount: "60000" }] });
    expect(pqcLayers(Uint8Array.from(res.signed.bodyBytes))).toHaveLength(1);
    const txBytes = encodeTxRaw({
      bodyBytes: Uint8Array.from(res.signed.bodyBytes),
      authInfoBytes,
      signatures: [fromBase64(res.signature.signature)],
    });
    expect(
      verifyHybridTx({ txBytes, chainId: "qorechain-diana", accountNumber: 42n, classicalPublicKey: classical.publicKey, pqPublicKey: pq.publicKey })
        .valid,
    ).toBe(true);
  });

  it("signDirect keeps authInfoBytes when the gas limit is enough", async () => {
    const { native } = setup({ profile: "planned" });
    const doc = signDoc(500_000n, false);
    const res = await native.signDirect(ADDRESS, doc);
    expect(res.signed.authInfoBytes).toEqual(Array.from(doc.authInfoBytes));
    expect(raiseGasForLayer(doc.authInfoBytes)).toBe(doc.authInfoBytes);
  });

  it("signDirect refuses an account without a registered key", async () => {
    const { native } = setup({ profile: "planned" }, null);
    const err = await rejection(native.signDirect(ADDRESS, signDoc(500_000n, false)));
    expect(err.message).toMatch(/no registered ML-DSA-87 key yet/);
  });

  it("getOfflineSigner signs through signDirect", async () => {
    const { native } = setup({ profile: "planned" });
    const signer = native.getOfflineSigner!("qorechain-diana");
    const [account] = await signer.getAccounts();
    expect(account!.address).toBe(ADDRESS);
    const doc = signDoc(500_000n, false);
    const res = await signer.signDirect(ADDRESS, { ...doc, accountNumber: 42n });
    expect(res.signed.accountNumber).toBe(42n);
    expect(res.signed.bodyBytes).toBeInstanceOf(Uint8Array);
    expect(() => native.getOfflineSigner!("cosmoshub-4")).toThrow("QoreX: unsupported chain cosmoshub-4");
  });

  it("signArbitrary follows message-signing-v1", async () => {
    const { native } = setup({ profile: "planned" });
    const signature = await native.signArbitrary("qorechain-diana", ADDRESS, "Sign in to the demo");
    expect(signature.signatureType).toBe("ml-dsa-87-hybrid");
    expect(() =>
      verifyMessage({ chainId: "qorechain-diana", signer: ADDRESS, data: "Sign in to the demo", signature, pqPublicKey: pq.publicKey }),
    ).not.toThrow();
    expect(() =>
      verifyMessage({ chainId: "qorechain-vladi", signer: ADDRESS, data: "Sign in to the demo", signature, pqPublicKey: pq.publicKey }),
    ).toThrow();
  });

  it("signArbitrary refuses mainnet without allowMainnet", async () => {
    const { native } = setup({ profile: "planned" });
    const err = await rejection(native.signArbitrary("qorechain-vladi", ADDRESS, "x"));
    expect(err.message).toMatch(/qorechain-vladi \(mainnet\) is refused/);
  });
});
