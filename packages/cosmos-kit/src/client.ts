// SPDX-License-Identifier: Apache-2.0
//
// cosmos-kit WalletClient over `window.qorex.native`.

import type { ChainRecord, DirectSignDoc, SignType, SimpleAccount, WalletAccount, WalletClient } from "@cosmos-kit/core";
import {
  QOREX_AMINO_REFUSED_MESSAGE,
  QorexIntegrationError,
  QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER,
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

type OfflineDirectSigner = ReturnType<NonNullable<WalletClient["getOfflineSignerDirect"]>>;
type OfflineAminoSigner = ReturnType<NonNullable<WalletClient["getOfflineSignerAmino"]>>;
type DirectSignResponse = Awaited<ReturnType<NonNullable<WalletClient["signDirect"]>>>;
type AminoSignResponse = Awaited<ReturnType<NonNullable<WalletClient["signAmino"]>>>;
type StdSignature = Awaited<ReturnType<NonNullable<WalletClient["signArbitrary"]>>>;

/** `getKey` result with bytes as `Uint8Array` (cosmos-kit `Key`). */
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

/** Converts a QoreX key (`number[]` bytes) to the cosmos-kit `Key` shape. */
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

/** cosmos-kit client for QoreX. */
export class QorexClient implements WalletClient {
  readonly client: QorexNativeProvider;

  constructor(client: QorexNativeProvider) {
    this.client = client;
  }

  async enable(chainIds: string | string[]): Promise<void> {
    for (const chainId of Array.isArray(chainIds) ? chainIds : [chainIds]) {
      await this.client.enable(chainId);
    }
  }

  async connect(chainIds: string | string[]): Promise<void> {
    await this.enable(chainIds);
  }

  /** QoreX `getKey`, with `pubKey` and `address` converted to `Uint8Array`. */
  async getKey(chainId: string): Promise<QorexCosmosKey> {
    return toCosmosKey(await this.client.getKey(chainId));
  }

  async getSimpleAccount(chainId: string): Promise<SimpleAccount> {
    const { address, username } = await this.getAccount(chainId);
    return { namespace: "cosmos", chainId, address, username };
  }

  async getAccount(chainId: string): Promise<WalletAccount> {
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
   * QoreX has no Amino signer, so every preference is served by the direct
   * signer (cosmos-kit asks for "amino" by default). See `getOfflineSignerDirect`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getOfflineSigner(chainId: string, preferredSignType?: SignType): OfflineDirectSigner {
    return this.getOfflineSignerDirect(chainId);
  }

  /** Refused by design: throws `QOREX_AMINO_REFUSED`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getOfflineSignerAmino(chainId?: string): OfflineAminoSigner {
    return refuseAmino();
  }

  /**
   * Direct signer built from `getKey` and `signDirect`.
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
  getOfflineSignerDirect(chainId: string): OfflineDirectSigner {
    return {
      getAccounts: async () => [await this.getAccount(chainId)],
      signDirect: async (signerAddress, signDoc) => {
        const onQoreChain = isQoreChainChainId(chainId) || isQoreChainChainId(signDoc.chainId);
        if (onQoreChain && !hasCapability(this.client, QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER)) {
          throw new QorexIntegrationError("QOREX_USE_SIGN_AND_BROADCAST", useSignAndBroadcastMessage(chainId), {
            chainId,
          });
        }
        // QoreX's signed document is returned as is: it may differ from signDoc.
        return this.signDirect(chainId, signerAddress, signDoc);
      },
    };
  }

  /**
   * QoreX `signDirect`, unchanged in meaning: signs the SignDoc as is.
   * Converts bytes and the account number for the page bridge and back.
   * On QoreChain, QoreX requires the hybrid layer to be present already;
   * use `signAndBroadcast` there.
   */
  async signDirect(
    chainId: string,
    signer: string,
    signDoc: DirectSignDoc | { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; chainId: string; accountNumber: bigint },
  ): Promise<DirectSignResponse> {
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
  async signAmino(): Promise<AminoSignResponse> {
    return refuseAmino();
  }

  /** Throws `QOREX_NOT_SUPPORTED_YET`; ADR-36 signing is planned in a future QoreX version. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async signArbitrary(chainId?: string, signer?: string, data?: string | Uint8Array): Promise<StdSignature> {
    throw new QorexIntegrationError("QOREX_NOT_SUPPORTED_YET", notSupportedYetMessage("signArbitrary (ADR-36)"));
  }

  /** QoreChain networks are built into QoreX; other chains are rejected by QoreX (code 4902). */
  async addChain(chainInfo: ChainRecord): Promise<void> {
    const chain = chainInfo.chain as { chain_id?: string; chain_name?: string } | undefined;
    const chainId = chain?.chain_id;
    if (!chainId) return;
    await this.client.experimentalSuggestChain({ chainId, chainName: chain?.chain_name ?? chainInfo.name });
  }

  /** The QoreChain path for a transaction. See `qorexSignAndBroadcast`. */
  async signAndBroadcast(request: QorexSignAndBroadcastRequest): Promise<QorexSignAndBroadcastResult> {
    return qorexSignAndBroadcast(request, { native: this.client });
  }
}
