// SPDX-License-Identifier: Apache-2.0
//
// Interchain Kit Cosmos wallet over `window.qorex.native`.

import { CosmosWallet, type WalletAccount } from "@interchain-kit/core";
import {
  QOREX_AMINO_REFUSED_MESSAGE,
  QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER,
  QorexIntegrationError,
  hasCapability,
  isQoreChainChainId,
  notSupportedYetMessage,
  qorexSignAndBroadcast,
  useSignAndBroadcastMessage,
  type QorexKey,
  type QorexNativeProvider,
  type QorexSignAndBroadcastRequest,
  type QorexSignAndBroadcastResult,
  type QorexSignDirectResponse,
} from "@qorechain/qorex-types";

type OfflineSigner = Awaited<ReturnType<CosmosWallet["getOfflineSigner"]>>;
type OfflineDirectSigner = Extract<OfflineSigner, { signDirect: unknown }>;
type DirectSignDoc = Parameters<CosmosWallet["signDirect"]>[2];
type DirectSignResponse = Awaited<ReturnType<CosmosWallet["signDirect"]>>;
type AminoSignResponse = Awaited<ReturnType<CosmosWallet["signAmino"]>>;
type StdSignature = Awaited<ReturnType<CosmosWallet["signArbitrary"]>>;

/** `getKey` result with bytes as `Uint8Array`. */
export interface QorexCosmosKey {
  readonly name: string;
  readonly algo: string;
  readonly pubKey: Uint8Array;
  readonly address: Uint8Array;
  readonly bech32Address: string;
  readonly isNanoLedger: boolean;
}

/** Bytes from QoreX arrive as `number[]`; also accepts `Uint8Array` and array-like objects. */
export function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (value && typeof value === "object") return Uint8Array.from(Object.values(value as Record<string, number>));
  throw new TypeError("expected bytes");
}

/** Converts a QoreX key (`number[]` bytes) to the Keplr `Key` shape. */
export function toCosmosKey(key: QorexKey): QorexCosmosKey {
  return {
    name: key.name,
    algo: key.algo,
    pubKey: toUint8Array(key.pubKey),
    address: toUint8Array(key.address),
    bech32Address: key.bech32Address,
    isNanoLedger: key.isNanoLedger === true,
  };
}

function refuseAmino(): never {
  throw new QorexIntegrationError("QOREX_AMINO_REFUSED", QOREX_AMINO_REFUSED_MESSAGE);
}

/** Interchain Kit Cosmos wallet for QoreX. `client` is `window.qorex.native`. */
export class QorexCosmosWallet extends CosmosWallet {
  declare client: QorexNativeProvider;

  /** QoreX emits no keystore-change event, so nothing is bound. */
  override bindingEvent(): void {}

  override async connect(chainId: string): Promise<void> {
    await this.client.enable(chainId);
  }

  override async disconnect(): Promise<void> {}

  /** QoreX `getKey`, with `pubKey` and `address` converted to `Uint8Array`. */
  async getKey(chainId: string): Promise<QorexCosmosKey> {
    return toCosmosKey(await this.client.getKey(chainId));
  }

  override async getAccount(chainId: string): Promise<WalletAccount> {
    const key = await this.getKey(chainId);
    return {
      username: key.name,
      address: key.bech32Address,
      algo: key.algo as WalletAccount["algo"],
      pubkey: key.pubKey,
      isNanoLedger: key.isNanoLedger,
    };
  }

  /**
   * Direct signer built from `getKey` and `signDirect`. QoreX has no Amino
   * signer, so every preference is served by the direct signer.
   *
   * On QoreChain (`qorechain-vladi`, `qorechain-diana`) its `signDirect`
   * throws `QOREX_USE_SIGN_AND_BROADCAST`: a page cannot add the hybrid
   * ML-DSA-87 signature QoreChain requires, so send the messages with
   * `signAndBroadcast`. `getAccounts` works on every chain.
   *
   * Planned: when QoreX declares the `signDirectAddsPqcLayer` capability
   * (a future release), the signer forwards QoreChain SignDocs to QoreX,
   * which adds the layer and may raise gas and fee. The signer always
   * returns QoreX's `signed` document, never the one it was given.
   *
   * On other chain ids it forwards to QoreX `signDirect`. QoreX 0.3.x serves
   * QoreChain chain ids only and rejects others with "QoreX: unsupported chain".
   */
  override async getOfflineSigner(chainId: string): Promise<OfflineDirectSigner> {
    return {
      getAccounts: async () => [await this.getAccount(chainId)],
      signDirect: async (signer: string, signDoc: DirectSignDoc) => {
        const onQoreChain = isQoreChainChainId(chainId) || isQoreChainChainId(signDoc.chainId);
        if (onQoreChain && !hasCapability(this.client, QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER)) {
          throw new QorexIntegrationError("QOREX_USE_SIGN_AND_BROADCAST", useSignAndBroadcastMessage(chainId), {
            chainId,
          });
        }
        // QoreX's signed document is returned as is: it may differ from signDoc.
        return this.signDirect(chainId, signer, signDoc);
      },
    };
  }

  /**
   * QoreX `signDirect`, unchanged in meaning: signs the SignDoc as is.
   * Converts bytes and the account number for the page bridge and back.
   * On QoreChain, QoreX requires the hybrid layer to be present already;
   * use `signAndBroadcast` there.
   */
  override async signDirect(chainId: string, signer: string, signDoc: DirectSignDoc): Promise<DirectSignResponse> {
    const res: QorexSignDirectResponse = await this.client.signDirect(signer, {
      bodyBytes: Array.from(signDoc.bodyBytes ?? new Uint8Array()),
      authInfoBytes: Array.from(signDoc.authInfoBytes ?? new Uint8Array()),
      chainId: signDoc.chainId ?? chainId,
      accountNumber: (signDoc.accountNumber ?? 0n).toString(),
    });
    return {
      signature: res.signature,
      signed: {
        bodyBytes: toUint8Array(res.signed.bodyBytes),
        authInfoBytes: toUint8Array(res.signed.authInfoBytes),
        chainId: res.signed.chainId,
        accountNumber: BigInt(res.signed.accountNumber),
      },
    } as DirectSignResponse;
  }

  /** Refused by design: throws `QOREX_AMINO_REFUSED`. */
  override async signAmino(): Promise<AminoSignResponse> {
    return refuseAmino();
  }

  /** Throws `QOREX_NOT_SUPPORTED_YET`; ADR-36 signing is planned in a future QoreX version. */
  override async signArbitrary(): Promise<StdSignature> {
    throw new QorexIntegrationError("QOREX_NOT_SUPPORTED_YET", notSupportedYetMessage("signArbitrary (ADR-36)"));
  }

  /** Throws `QOREX_NOT_SUPPORTED_YET`. */
  override async verifyArbitrary(): Promise<boolean> {
    throw new QorexIntegrationError("QOREX_NOT_SUPPORTED_YET", notSupportedYetMessage("verifyArbitrary"));
  }

  /** QoreX has no `sendTx`: throws `QOREX_NOT_SUPPORTED_YET`. Broadcast through your RPC endpoint, or use `signAndBroadcast` on QoreChain. */
  override async sendTx(): Promise<Uint8Array> {
    throw new QorexIntegrationError(
      "QOREX_NOT_SUPPORTED_YET",
      notSupportedYetMessage("sendTx") + " Broadcast through your RPC endpoint, or use signAndBroadcast on QoreChain.",
    );
  }

  /** QoreChain networks are built into QoreX; other chains are rejected by QoreX (code 4902). */
  override async addSuggestChain(chainId: string): Promise<void> {
    await this.client.experimentalSuggestChain({ chainId });
  }

  /** The QoreChain path for a transaction. See `qorexSignAndBroadcast`. */
  async signAndBroadcast(request: QorexSignAndBroadcastRequest): Promise<QorexSignAndBroadcastResult> {
    return qorexSignAndBroadcast(request, { native: this.client });
  }
}
