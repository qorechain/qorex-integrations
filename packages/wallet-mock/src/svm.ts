// SPDX-License-Identifier: Apache-2.0
//
// Solana: the `window.qorex.svm` shim and a Wallet Standard wallet on
// `solana:mainnet`, as QoreX declares them. Both profiles behave the same.
// Messages and transactions are signed with the account's ed25519 key;
// the mock never sends a Solana transaction (`signAndSendTransaction` is
// refused with a message saying so).

import { ed25519 } from "@noble/curves/ed25519.js";
import { QOREX_MOCK_NAME, QOREX_SOLANA_ACCOUNT_FEATURES, QOREX_SOLANA_CHAINS } from "@qorechain/qorex-types";
import { QOREX_ICON_DATA_URI } from "@qorechain/qorex-types/icon";

import type { MockController, QorexMockRequest } from "./controller.js";
import { bytesFrom, walletError } from "./util.js";

const NOT_SENT = "QoreX (mock): the mock does not send Solana transactions. Use signTransaction and send it yourself.";

export interface QorexMockSvmProvider {
  readonly isQoreX: true;
  connect(): Promise<{ publicKey: string }>;
  signAndSendTransaction(transaction: Uint8Array | number[]): Promise<{ signature: string; publicKey: string }>;
  signMessage(message: Uint8Array | number[]): Promise<{ signature: number[]; publicKey: string }>;
}

function readCompactU16(buf: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = buf[at + i];
    if (b === undefined) throw new Error("truncated");
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, at + i + 1];
  }
  throw new Error("bad length");
}

/** Signs the wire transaction with `seed` in the slot of `publicKey`. */
function signSolanaTransaction(wire: Uint8Array, seed: Uint8Array, publicKey: Uint8Array): Uint8Array {
  let sigCount: number;
  let at: number;
  try {
    [sigCount, at] = readCompactU16(wire, 0);
  } catch {
    throw walletError("QoreX: invalid Solana transaction");
  }
  const sigStart = at;
  const msgStart = sigStart + sigCount * 64;
  const message = wire.subarray(msgStart);
  let p = (message[0] ?? 0) & 0x80 ? 1 : 0;
  const required = message[p];
  if (required === undefined) throw walletError("QoreX: invalid Solana transaction");
  const [keyCount, keysAt] = readCompactU16(message, p + 3);
  p = keysAt;
  let slot = -1;
  for (let i = 0; i < Math.min(required, keyCount); i++) {
    const k = message.subarray(p + i * 32, p + i * 32 + 32);
    if (k.length === 32 && k.every((b, j) => b === publicKey[j])) slot = i;
  }
  if (slot < 0 || slot >= sigCount) throw walletError("QoreX: this transaction does not need this wallet's signature");
  const out = Uint8Array.from(wire);
  out.set(ed25519.sign(message, seed), sigStart + slot * 64);
  return out;
}

export function createSvm(ctl: MockController) {
  async function signApproval(entry: QorexMockRequest): Promise<void> {
    await ctl.ensureConnected(entry);
    if (!(await ctl.approval(entry))) throw walletError("QoreX: signature rejected");
  }

  const connect = () =>
    ctl.run("svm:connect", {}, async (entry) => {
      await ctl.ensureConnected(entry);
      return { publicKey: ctl.account.svm.address };
    });

  const signMessage = (message: unknown) =>
    ctl.run("svm:signMessage", { message }, async (entry) => {
      const bytes = bytesFrom(message);
      if (bytes.length === 0 || bytes.length > 4096) throw walletError("QoreX: invalid message length");
      await signApproval(entry);
      const svm = ctl.account.svm;
      return { signature: Array.from(ed25519.sign(bytes, svm.seed)), publicKey: svm.address };
    });

  const signTransaction = (tx: unknown) =>
    ctl.run("svm:signTransaction", { tx }, async (entry) => {
      await signApproval(entry);
      const svm = ctl.account.svm;
      return Array.from(signSolanaTransaction(bytesFrom(tx), svm.seed, svm.publicKey));
    });

  const sendRefused = (tx: unknown) =>
    ctl.run("svm:signAndSendTransaction", { tx }, async () => {
      throw walletError(NOT_SENT);
    });

  const shim: QorexMockSvmProvider = {
    isQoreX: true,
    connect,
    signAndSendTransaction: (transaction) => sendRefused(transaction) as never,
    signMessage: (message) => signMessage(message),
  };

  // Wallet Standard -------------------------------------------------------------
  type Account = {
    address: string;
    publicKey: Uint8Array;
    chains: readonly string[];
    features: readonly string[];
  };
  let accounts: Account[] = [];
  const listeners = new Set<(p: { accounts?: readonly Account[] }) => void>();
  const emit = () => {
    for (const l of [...listeners]) l({ accounts });
  };

  const standardWallet = {
    version: "1.0.0" as const,
    name: QOREX_MOCK_NAME,
    icon: QOREX_ICON_DATA_URI,
    chains: QOREX_SOLANA_CHAINS,
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          const { publicKey } = await connect();
          const svm = ctl.account.svm;
          accounts = [{ address: publicKey, publicKey: svm.publicKey, chains: QOREX_SOLANA_CHAINS, features: QOREX_SOLANA_ACCOUNT_FEATURES }];
          emit();
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          accounts = [];
          emit();
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, listener: (p: { accounts?: readonly Account[] }) => void) => {
          if (event === "change") listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => {
          await sendRefused(inputs[0]?.transaction);
          return [];
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => {
          const out: Array<{ signedTransaction: Uint8Array }> = [];
          for (const input of inputs) out.push({ signedTransaction: Uint8Array.from(await signTransaction(input.transaction)) });
          return out;
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs: Array<{ message: Uint8Array }>) => {
          const out: Array<{ signedMessage: Uint8Array; signature: Uint8Array }> = [];
          for (const input of inputs) {
            const res = await signMessage(input.message);
            out.push({ signedMessage: input.message, signature: Uint8Array.from(res.signature) });
          }
          return out;
        },
      },
    },
  };

  return { shim, standardWallet };
}

export type QorexMockSolanaWallet = ReturnType<typeof createSvm>["standardWallet"];

/** Wallet Standard registration handshake, as QoreX does it. */
export function registerStandardWallet(win: Window, wallet: QorexMockSolanaWallet): void {
  const callback = (api: { register(w: unknown): unknown }) => {
    try {
      api.register(wallet);
    } catch {
      /* an app refusing registration must not break the page */
    }
  };
  try {
    win.dispatchEvent(new (win as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent("wallet-standard:register-wallet", { detail: callback }));
  } catch {
    /* ignore */
  }
  win.addEventListener("wallet-standard:app-ready", (ev) => {
    const api = (ev as CustomEvent<{ register(w: unknown): unknown }>).detail;
    if (api && typeof api.register === "function") callback(api);
  });
}

