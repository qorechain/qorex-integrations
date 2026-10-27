// SPDX-License-Identifier: Apache-2.0
//
// QoreChain native provider (`window.qorex.native`).
//
// Both profiles: enable, getKey, signAndBroadcast (hybrid secp256k1 +
// ML-DSA-87, broadcast to the REST endpoint), listAccounts,
// experimentalSuggestChain; signDirect of a SignDoc that already carries a
// valid hybrid layer for the account's registered key. Amino is not provided.
//
// planned: signDirect adds the layer itself when the SignDoc has none (see
// `raiseGasForLayer`), getOfflineSigner, signArbitrary per message-signing-v1
// and the `signDirectAddsPqcLayer` capability.

import {
  QORECHAIN_CHAIN_IDS,
  QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER,
  QOREX_NATIVE_CAPABILITIES,
  type QorexKey,
  type QorexNativeProvider,
  type QorexSignAndBroadcastRequest,
  type QorexSignAndBroadcastResult,
  type QorexSignDirectResponse,
  type QorexSignDocInput,
  type QorexSuggestChainInput,
} from "@qorechain/qorex-types";
import {
  buildRegisterPqKeyMessage,
  classicalSign,
  encodeSignDoc,
  evaluateLayerState,
  parseAddress,
  pqcLayers,
  signHybrid,
  signMessage,
  signPqLayer,
  toBase64,
  toHex,
  type MessageSignature,
} from "@qorechain/qoresign";
import {
  assertPqLayerMatchesRegisteredKey,
  broadcastTx,
  fetchPqKeyStatus,
  resolveSignBytesVersion,
  submitWithSignBytesFallback,
} from "@qorechain/qoresign/network";
import { fetchAccountInfo, waitForTx } from "./chain.js";
import type { MockController, QorexMockRequest } from "./controller.js";
import {
  bodyMessageTypeUrls,
  encodeAuthInfo,
  encodeFee,
  encodeTxBody,
  readAuthInfoFee,
  replaceAuthInfoFee,
  type AnyMsg,
} from "./proto.js";
import { bytesFrom, walletError } from "./util.js";

/** Messages only the wallet itself may send. */
export const WALLET_ONLY_TYPE_URLS: ReadonlySet<string> = new Set([
  "/qorechain.pqc.v1.MsgRegisterPQCKey",
  "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
  "/qorechain.pqc.v1.MsgMigratePQCKey",
  "/qorechain.pqc.v1.MsgRotatePQCKey",
]);

/** Gas price QoreX uses on QoreChain: 0.15 uqor per gas, rounded up. */
export function feeForGas(gasLimit: bigint): bigint {
  return (150_000n * gasLimit + 999_999n) / 1_000_000n;
}

/** The gas limit below which the planned `signDirect` raises the gas limit. */
export const PLANNED_MIN_HYBRID_GAS = 400_000n;

function clampGas(v: unknown): bigint {
  let g = 400_000n;
  try {
    if (v !== undefined && v !== null && v !== "") g = BigInt(String(v));
  } catch {
    g = 400_000n;
  }
  if (g < 100_000n) return 100_000n;
  if (g > 5_000_000n) return 5_000_000n;
  return g;
}

/**
 * The planned `signDirect` does not simulate. When the SignDoc's gas limit
 * is below 400,000 it raises it to 400,000 and the uqor fee to at least
 * 0.15 uqor per gas, and returns the new `authInfoBytes`. Otherwise the
 * page's `authInfoBytes` are returned unchanged.
 */
export function raiseGasForLayer(authInfoBytes: Uint8Array): Uint8Array {
  const fee = readAuthInfoFee(authInfoBytes);
  if (fee.gasLimit >= PLANNED_MIN_HYBRID_GAS) return authInfoBytes;
  const required = feeForGas(PLANNED_MIN_HYBRID_GAS);
  const amount = fee.amount.map((c) => ({ ...c }));
  const uqor = amount.find((c) => c.denom === "uqor");
  if (uqor) {
    if (BigInt(uqor.amount || "0") < required) uqor.amount = required.toString();
  } else {
    amount.push({ denom: "uqor", amount: required.toString() });
  }
  return replaceAuthInfoFee(authInfoBytes, encodeFee(amount, PLANNED_MIN_HYBRID_GAS, fee.rest));
}

/** Cosmos `OfflineDirectSigner` shape returned by the planned `getOfflineSigner`. */
export interface QorexMockOfflineSigner {
  getAccounts(): Promise<Array<{ address: string; algo: "secp256k1"; pubkey: Uint8Array }>>;
  signDirect(
    signerAddress: string,
    signDoc: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; chainId: string; accountNumber: bigint | number | string },
  ): Promise<{
    signed: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; chainId: string; accountNumber: bigint };
    signature: QorexSignDirectResponse["signature"];
  }>;
}

/** The mock's `window.qorex.native`. `getOfflineSigner` exists in the planned profile only. */
export type QorexMockNativeProvider = Omit<QorexNativeProvider, "signArbitrary"> & {
  /** current: refused. planned: message-signing-v1 signature (ADR-36 secp256k1 plus ML-DSA-87). */
  signArbitrary(chainId: string, signer: string, data: string | Uint8Array): Promise<MessageSignature>;
  getOfflineSigner?: (chainId: string) => QorexMockOfflineSigner;
};

export function createNativeProvider(ctl: MockController): QorexMockNativeProvider {
  const rest = () => ({ rest: ctl.rest, fetch: ctl.fetch });

  function requireChain(chainId: unknown): void {
    if (chainId && !(QORECHAIN_CHAIN_IDS as readonly unknown[]).includes(chainId)) {
      throw walletError(`QoreX: unsupported chain ${String(chainId)}`);
    }
  }

  function assertNoWalletOnly(typeUrls: readonly string[]): void {
    const reserved = typeUrls.find((u) => WALLET_ONLY_TYPE_URLS.has(u));
    if (reserved) throw walletError(`QoreX: ${reserved} is managed by the wallet itself, not by a website`);
  }

  async function signingApproval(entry: QorexMockRequest): Promise<void> {
    if (!(await ctl.approval(entry))) throw walletError("QoreX: signature rejected");
  }

  async function assertRegisteredKeyIsOurs(address: string, pqPublicKey: Uint8Array, missing: string): Promise<boolean> {
    const status = await fetchPqKeyStatus({ ...rest(), address });
    if (!status.registered || !status.publicKey) {
      if (missing) throw walletError(missing);
      return false;
    }
    if (toHex(status.publicKey) !== toHex(pqPublicKey)) {
      throw walletError(`QoreX: the ML-DSA-87 key registered for ${address} is not this wallet's key`);
    }
    return true;
  }

  async function sendAndWait(chainId: string, txBytes: Uint8Array, what: string) {
    const r = await broadcastTx({ ...rest(), txBytes });
    if (r.code !== 0) throw walletError(`QoreX: ${what} was refused (code ${r.code}): ${r.log}`);
    const committed = await waitForTx({
      ...rest(),
      txhash: r.txhash,
      timeoutMs: ctl.options.inclusionTimeoutMs,
      pollMs: ctl.options.pollIntervalMs,
    });
    if (!committed) throw walletError(`QoreX: ${what} was not included on ${chainId} in time`);
    if (committed.code !== 0) throw walletError(`QoreX: ${what} failed on chain (code ${committed.code})`);
  }

  /** Register-once: the first hybrid transaction of an account is preceded by its key registration. */
  async function ensureRegistered(chainId: string): Promise<void> {
    const acct = ctl.account;
    const { key, address } = acct.native;
    if (await assertRegisteredKeyIsOurs(address, acct.pq.publicKey, "")) return;
    const msg = buildRegisterPqKeyMessage({ chainId, account: address, pqKey: acct.pq, classicalPublicKey: key.publicKey });
    const info = await fetchAccountInfo({ ...rest(), address, chainId });
    const gasLimit = 400_000n;
    const signed = signHybrid({
      chainId,
      accountNumber: info.accountNumber,
      bodyBytes: encodeTxBody([msg], ""),
      authInfoBytes: encodeAuthInfo({
        publicKey: key.publicKey,
        sequence: info.sequence,
        fee: [{ denom: "uqor", amount: feeForGas(gasLimit).toString() }],
        gasLimit,
      }),
      classicalKey: key,
      mode: "classicalOnly",
    });
    await sendAndWait(chainId, signed.txBytes, "registering the ML-DSA-87 key");
  }

  async function broadcastHybrid(chainId: string, messages: AnyMsg[], memo: string, gasLimit: bigint): Promise<QorexSignAndBroadcastResult> {
    await ensureRegistered(chainId);
    const acct = ctl.account;
    const { key, address } = acct.native;
    const info = await fetchAccountInfo({ ...rest(), address, chainId });
    const bodyBytes = encodeTxBody(messages, memo);
    const authInfoBytes = encodeAuthInfo({
      publicKey: key.publicKey,
      sequence: info.sequence,
      fee: [{ denom: "uqor", amount: feeForGas(gasLimit).toString() }],
      gasLimit,
    });
    const res = await submitWithSignBytesFallback({
      ...rest(),
      chainId,
      sign: (version) =>
        signHybrid({
          chainId,
          accountNumber: info.accountNumber,
          bodyBytes,
          authInfoBytes,
          classicalKey: key,
          pqKey: acct.pq,
          signBytesVersion: version,
        }).txBytes,
    });
    if (res.code !== 0) {
      throw walletError(
        `QoreX: the network refused the transaction (code ${res.code}${res.codespace ? `, ${res.codespace}` : ""}): ${res.log}`,
      );
    }
    const committed = await waitForTx({
      ...rest(),
      txhash: res.txhash,
      timeoutMs: ctl.options.inclusionTimeoutMs,
      pollMs: ctl.options.pollIntervalMs,
    });
    if (committed && committed.code !== 0) throw walletError(`Transaction failed on-chain (code ${committed.code}).`);
    const state = evaluateLayerState({
      lane: "native",
      onQoreChain: true,
      signedWithPqLayer: true,
      ...(committed ? { committedExtensionTypeUrls: committed.extensionTypeUrls } : {}),
    });
    return {
      txHash: res.txhash,
      code: committed?.code ?? 0,
      ...(committed ? { height: committed.height } : {}),
      shield: state === "protected" ? "shielded" : state,
    };
  }

  const keyFor = (): QorexKey => {
    const { key, address } = ctl.account.native;
    return {
      name: "QoreX",
      algo: "secp256k1",
      pubKey: Array.from(key.publicKey),
      address: Array.from(parseAddress(address).bytes),
      bech32Address: address,
      pubKeyHex: toHex(key.publicKey),
      isNanoLedger: false,
    };
  };

  const provider: QorexMockNativeProvider = {
    isQoreX: true,
    capabilities: ctl.planned
      ? [...QOREX_NATIVE_CAPABILITIES, QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER]
      : [...QOREX_NATIVE_CAPABILITIES],

    enable: (chainId) =>
      ctl.run("native:enable", { chainId }, async (entry) => {
        requireChain(chainId);
        await ctl.ensureConnected(entry);
        return null;
      }),

    getKey: (chainId) =>
      ctl.run("native:getKey", { chainId }, async (entry) => {
        requireChain(chainId);
        await ctl.ensureConnected(entry);
        return keyFor();
      }),

    signDirect: (signerAddress: string, signDoc: QorexSignDocInput) =>
      ctl.run("native:signDirect", { signerAddress, signDoc }, async (entry) => {
        await ctl.ensureConnected(entry);
        const acct = ctl.account;
        if (signerAddress !== acct.native.address) throw walletError("QoreX: unknown signer address");
        const doc = (signDoc ?? {}) as Partial<QorexSignDocInput>;
        const chainId = String(doc.chainId ?? "");
        requireChain(chainId);
        if (chainId !== ctl.chainId) {
          throw walletError(`QoreX: signature chain ${chainId} does not match the active network ${ctl.chainId}`);
        }
        ctl.assertNetworkAllowed(chainId);
        let bodyBytes = bytesFrom(doc.bodyBytes);
        let authInfoBytes = bytesFrom(doc.authInfoBytes);
        const accountNumber = BigInt(String(doc.accountNumber ?? "0"));
        let addLayer = false;
        if (pqcLayers(bodyBytes).length > 0) {
          try {
            await assertPqLayerMatchesRegisteredKey({ ...rest(), chainId, signer: signerAddress, bodyBytes, authInfoBytes });
          } catch (err) {
            throw walletError(`QoreX refused to sign: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (ctl.planned) {
          await assertRegisteredKeyIsOurs(
            signerAddress,
            acct.pq.publicKey,
            "QoreX: this account has no registered ML-DSA-87 key yet. Send one transaction with signAndBroadcast first.",
          );
          addLayer = true;
          authInfoBytes = raiseGasForLayer(authInfoBytes);
        } else {
          throw walletError(
            "QoreX refused to sign: this app must add QoreChain's hybrid ML-DSA-87 layer before signing. " +
              "A bare classical signature over a QoreChain transaction is not allowed.",
          );
        }
        assertNoWalletOnly(bodyMessageTypeUrls(bodyBytes));
        await signingApproval(entry);
        if (addLayer) {
          const signBytesVersion = await resolveSignBytesVersion({ ...rest(), chainId });
          bodyBytes = signPqLayer({ chainId, bodyBytes, authInfoBytes, pqKey: acct.pq, signBytesVersion }).bodyBytes;
        }
        const signature = classicalSign(acct.native.key, encodeSignDoc({ bodyBytes, authInfoBytes, chainId, accountNumber }));
        const response: QorexSignDirectResponse = {
          signature: {
            pub_key: { type: "/cosmos.crypto.secp256k1.PubKey", value: toBase64(acct.native.key.publicKey) },
            signature: toBase64(signature),
          },
          signed: {
            bodyBytes: Array.from(bodyBytes),
            authInfoBytes: Array.from(authInfoBytes),
            chainId,
            accountNumber: accountNumber.toString(),
          },
        };
        return response;
      }),

    signAndBroadcast: (request: QorexSignAndBroadcastRequest) =>
      ctl.run("native:signAndBroadcast", request, async (entry) => {
        await ctl.ensureConnected(entry);
        const req = (request ?? {}) as Partial<QorexSignAndBroadcastRequest>;
        const chainId = String(req.chainId ?? "");
        requireChain(chainId);
        if (chainId !== ctl.chainId) {
          throw walletError(`QoreX: chain ${chainId} does not match the active network ${ctl.chainId}`);
        }
        const list = Array.isArray(req.messages) ? req.messages : [];
        if (list.length < 1 || list.length > 32) throw walletError("QoreX: send between 1 and 32 messages");
        const messages = list.map((m) => {
          const typeUrl = String(m?.typeUrl ?? "");
          if (!/^\/[A-Za-z0-9_.]+$/.test(typeUrl)) throw walletError("QoreX: invalid message type URL");
          return { typeUrl, value: bytesFrom(m?.value) };
        });
        const memo = typeof req.memo === "string" ? req.memo : "";
        if (new TextEncoder().encode(memo).length > 256) throw walletError("QoreX: the memo may be at most 256 bytes");
        assertNoWalletOnly(messages.map((m) => m.typeUrl));
        ctl.assertNetworkAllowed(chainId);
        await signingApproval(entry);
        return broadcastHybrid(chainId, messages, memo, clampGas(req.gasLimit));
      }),

    signArbitrary: (chainId: string, signer: string, data: string | Uint8Array) =>
      ctl.run("native:signArbitrary", { chainId, signer, data }, async (entry) => {
        if (!ctl.planned) throw walletError("QoreX: signArbitrary not yet supported");
        await ctl.ensureConnected(entry);
        if (!(QORECHAIN_CHAIN_IDS as readonly string[]).includes(chainId)) {
          throw walletError(`QoreX: unsupported chain ${String(chainId)}`);
        }
        const acct = ctl.account;
        if (signer !== acct.native.address) throw walletError("QoreX: unknown signer address");
        ctl.assertNetworkAllowed(chainId);
        await signingApproval(entry);
        return signMessage({
          chainId,
          signer,
          data: typeof data === "string" ? data : bytesFrom(data),
          classicalKey: acct.native.key,
          pqKey: acct.pq,
        });
      }),

    experimentalSuggestChain: (chainInfo: QorexSuggestChainInput) =>
      ctl.run("native:suggestChain", { chainInfo }, async () => {
        const suggested = String((chainInfo as { chainId?: unknown } | undefined)?.chainId ?? "");
        if (suggested.startsWith("qorechain-")) return null;
        throw walletError(
          `QoreX supports QoreChain networks only: cannot add foreign chain ${suggested || "(unknown)"}.`,
          4902,
        );
      }),

    connectProof: (sessionId) =>
      ctl.run("native:connectProof", { sessionId }, async () => {
        throw walletError("QoreX: this method is available to the QoreChain dashboard only");
      }),

    executeTransfer: (request) =>
      ctl.run("native:executeTransfer", request, async () => {
        throw walletError("QoreX: this method is available to the QoreChain dashboard only");
      }),

    executeRequest: (params) =>
      ctl.run("native:executeRequest", params, async () => {
        throw walletError("QoreX: this method is available to the QoreChain dashboard only");
      }),

    listAccounts: () =>
      ctl.run("native:listAccounts", {}, async (entry) => {
        await ctl.ensureConnected(entry);
        return {
          accounts: ctl.knownIndexes().map((index) => ({
            index,
            label: `Account ${index + 1}`,
            address: ctl.accountAt(index).native.address,
          })),
          activeIndex: ctl.activeIndex,
        };
      }),
  };

  if (ctl.planned) {
    provider.getOfflineSigner = (chainId: string): QorexMockOfflineSigner => {
      if (!(QORECHAIN_CHAIN_IDS as readonly string[]).includes(chainId)) {
        throw walletError(`QoreX: unsupported chain ${String(chainId)}`);
      }
      return {
        getAccounts: async () => {
          const key = await provider.getKey(chainId);
          return [{ address: key.bech32Address, algo: "secp256k1", pubkey: Uint8Array.from(key.pubKey) }];
        },
        signDirect: async (signerAddress, signDoc) => {
          const r = await provider.signDirect(signerAddress, {
            bodyBytes: signDoc.bodyBytes,
            authInfoBytes: signDoc.authInfoBytes,
            chainId: signDoc.chainId,
            accountNumber: String(signDoc.accountNumber),
          });
          return {
            signed: {
              bodyBytes: Uint8Array.from(r.signed.bodyBytes),
              authInfoBytes: Uint8Array.from(r.signed.authInfoBytes),
              chainId: r.signed.chainId,
              accountNumber: BigInt(r.signed.accountNumber),
            },
            signature: r.signature,
          };
        },
      };
    };
  }

  return provider;
}
