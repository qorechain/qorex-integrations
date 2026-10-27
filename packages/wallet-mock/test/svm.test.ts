// SPDX-License-Identifier: Apache-2.0

import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { createQorexMock, type QorexMockInjected } from "../src/index.js";
import { freshWindow, rejection } from "./helpers.js";

// Same derivation as QoreX (m/44'/501'/{i}'/0').
const SVM_0 = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";
const SVM_1 = "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb";
const EVM_1 = "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0";

type StdWallet = {
  name: string;
  chains: readonly string[];
  features: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
};

function setup(profile: "current" | "planned" = "current") {
  const win = freshWindow();
  const registered: StdWallet[] = [];
  // An app that is listening before the wallet loads.
  win.addEventListener("wallet-standard:register-wallet", (ev) => {
    (ev as CustomEvent<(api: { register(w: unknown): void }) => void>).detail({ register: (w) => registered.push(w as StdWallet) });
  });
  const mock = createQorexMock({ profile });
  mock.install(win);
  const svm = (win as unknown as { qorex: QorexMockInjected }).qorex.svm;
  return { win, mock, svm, registered };
}

/** A legacy transaction with one signer (the wallet) and no instructions. */
function legacyTx(payer: Uint8Array): Uint8Array {
  const message = new Uint8Array([1, 0, 0, 1, ...payer, ...new Uint8Array(32), 0]);
  return new Uint8Array([1, ...new Uint8Array(64), ...message]);
}

describe.each(["current", "planned"] as const)("Solana, %s profile", (profile) => {
  it("derives the same accounts as QoreX", () => {
    expect(createQorexMock().addresses().svm).toBe(SVM_0);
    expect(createQorexMock({ accountIndex: 1 }).addresses()).toMatchObject({ svm: SVM_1, evm: EVM_1 });
  });

  it("window.qorex.svm connects and signs a message", async () => {
    const { svm } = setup(profile);
    expect(await svm.connect()).toEqual({ publicKey: SVM_0 });
    const message = new TextEncoder().encode("hello solana");
    const res = await svm.signMessage(message);
    expect(res.publicKey).toBe(SVM_0);
    expect(ed25519.verify(Uint8Array.from(res.signature), message, base58.decode(SVM_0))).toBe(true);
    expect((await rejection(svm.signMessage(new Uint8Array()))).message).toBe("QoreX: invalid message length");
  });

  it("registers a Wallet Standard wallet on solana:mainnet only", async () => {
    const { registered, win } = setup(profile);
    expect(registered).toHaveLength(1);
    const wallet = registered[0]!;
    expect(wallet.name).toBe("QoreX (mock)");
    expect(wallet.chains).toEqual(["solana:mainnet"]);
    expect(Object.keys(wallet.features)).not.toContain("solana:signIn");
    // An app that starts later asks with app-ready.
    const late: unknown[] = [];
    win.dispatchEvent(new (win as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent("wallet-standard:app-ready", { detail: { register: (w: unknown) => late.push(w) } }));
    expect(late).toEqual([wallet]);
  });

  it("Wallet Standard signTransaction fills the wallet's signature slot", async () => {
    const { registered } = setup(profile);
    const wallet = registered[0]!;
    const { accounts } = (await wallet.features["standard:connect"]!.connect!()) as { accounts: Array<{ publicKey: Uint8Array }> };
    const pk = accounts[0]!.publicKey;
    const tx = legacyTx(pk);
    const [out] = (await wallet.features["solana:signTransaction"]!.signTransaction!({ transaction: tx })) as Array<{
      signedTransaction: Uint8Array;
    }>;
    const sig = out!.signedTransaction.subarray(1, 65);
    expect(ed25519.verify(sig, tx.subarray(65), pk)).toBe(true);
  });

  it("does not send Solana transactions", async () => {
    const { svm } = setup(profile);
    const err = await rejection(svm.signAndSendTransaction(new Uint8Array([0])));
    expect(err.message).toMatch(/does not send Solana transactions/);
  });
});
