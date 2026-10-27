// SPDX-License-Identifier: Apache-2.0
//
// The objects QoreX injects into a page: `window.qorex = { evm, native, svm }`,
// the EIP-6963 announcement and the Solana Wallet Standard wallet.
//
// Every call crosses from the page to the extension as a message, so values
// travel as plain JSON: bytes come back as `number[]`, never `Uint8Array`, and
// `bigint` cannot be sent. Errors are plain `Error` objects whose `message`
// starts with "QoreX:"; only a few carry a numeric `code` (4902 for an unknown
// chain). A user rejection has no EIP-1193 4001 code yet.

import type { QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER, QOREX_NATIVE_CAPABILITIES, QOREX_RDNS } from "./constants.js";

// EIP-1193 / EIP-6963 -------------------------------------------------------

/** Minimal EIP-1193 request arguments. */
export interface Eip1193RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

/** Minimal EIP-1193 provider, enough to tell providers apart. */
export interface Eip1193ProviderLike {
  request(args: Eip1193RequestArguments): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** EIP-6963 provider info. */
export interface Eip6963ProviderInfo {
  readonly uuid: string;
  readonly name: string;
  /** Data URI, at least 96 x 96. */
  readonly icon: string;
  readonly rdns: string;
}

/** EIP-6963 `eip6963:announceProvider` event detail. */
export interface Eip6963ProviderDetail<P extends Eip1193ProviderLike = Eip1193ProviderLike> {
  readonly info: Eip6963ProviderInfo;
  readonly provider: P;
}

/** EIP-6963 `eip6963:announceProvider` event. */
export type Eip6963AnnounceProviderEvent<P extends Eip1193ProviderLike = Eip1193ProviderLike> = CustomEvent<
  Eip6963ProviderDetail<P>
>;

/**
 * The QoreX EVM provider (`window.qorex.evm`, also announced through EIP-6963).
 * QoreX never writes `window.ethereum`.
 *
 * Methods answered by QoreX extension 0.3.x:
 * - `eth_chainId`: `"0x2649"` (9801, mainnet) or `"0x2648"` (9800, testnet), the network
 *   selected in the wallet; answers while locked.
 * - `eth_accounts`: `[address]` when unlocked and the site is connected, otherwise `[]`.
 * - `eth_requestAccounts`: asks the user to connect the site, then `[address]`.
 * - `wallet_switchEthereumChain`: resolves `null` for the active chain; any other
 *   chain rejects with code 4902.
 *
 * Every other method, including `personal_sign`, `eth_signTypedData_v4`,
 * `eth_sendTransaction` and `wallet_addEthereumChain`, rejects with
 * "QoreX: EVM method <name> not yet supported".
 *
 * Events: `on` and `removeListener` register listeners, but QoreX does not
 * emit `accountsChanged`, `chainChanged`, `connect` or `disconnect` yet.
 *
 * Errors: today only the 4902 above carries a code; every other refusal is a
 * plain message. Planned for a future QoreX release: `accountsChanged` and
 * `chainChanged` events; code 4200 on methods it does not answer and 4902 on
 * unknown chains, next to the same message text; then `personal_sign`,
 * `eth_signTypedData_v4`, `eth_sendTransaction` and `wallet_addEthereumChain`.
 * Check `code` first and fall back to the message text
 * (`isQorexUnsupportedMethodError`, `isQorexUnrecognizedChainError`).
 */
export interface QorexEip1193Provider extends Eip1193ProviderLike {
  readonly isQoreX: true;
  request(args: Eip1193RequestArguments): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/** EIP-6963 provider info QoreX announces. */
export interface QorexEip6963ProviderInfo extends Eip6963ProviderInfo {
  readonly name: "QoreX";
  readonly rdns: typeof QOREX_RDNS;
}

/** EIP-6963 announcement detail QoreX dispatches. */
export interface QorexEip6963ProviderDetail extends Eip6963ProviderDetail<QorexEip1193Provider> {
  readonly info: QorexEip6963ProviderInfo;
}

// Native (QoreChain) ----------------------------------------------------------

/** A capability string from `QOREX_NATIVE_CAPABILITIES`, or one announced for a future release. */
export type QorexNativeCapability =
  | (typeof QOREX_NATIVE_CAPABILITIES)[number]
  | typeof QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER;

/** Account key, Keplr `getKey` shape, as it arrives over the page bridge. */
export interface QorexKey {
  /** Always "QoreX". */
  readonly name: string;
  /** "secp256k1". */
  readonly algo: string;
  /** Compressed secp256k1 public key, 33 bytes. */
  readonly pubKey: number[];
  /** RIPEMD160(SHA256(pubKey)), 20 bytes. */
  readonly address: number[];
  /** `qor1...` address. */
  readonly bech32Address: string;
  /** Hex of `pubKey`. Present in current builds; kept for older callers. */
  readonly pubKeyHex?: string;
  /** Always false. */
  readonly isNanoLedger: boolean;
}

/** Bytes as QoreX accepts them from a page. */
export type QorexBytesInput = Uint8Array | number[];

/** SignDoc passed to `signDirect`. Send `accountNumber` as a string: `bigint` cannot cross the bridge. */
export interface QorexSignDocInput {
  readonly bodyBytes: QorexBytesInput;
  readonly authInfoBytes: QorexBytesInput;
  readonly chainId: string;
  readonly accountNumber: string | number;
}

/** Amino-JSON style signature object (`pub_key` is the secp256k1 key, base64). */
export interface QorexStdSignature {
  readonly pub_key: { readonly type: string; readonly value: string };
  /** Base64 secp256k1 signature. */
  readonly signature: string;
}

/** `signDirect` result, as it arrives over the page bridge. */
export interface QorexSignDirectResponse {
  readonly signature: QorexStdSignature;
  readonly signed: {
    readonly bodyBytes: number[];
    readonly authInfoBytes: number[];
    readonly chainId: string;
    /** Decimal string. */
    readonly accountNumber: string;
  };
}

/** One message for `signAndBroadcast`: type URL plus protobuf-encoded value. */
export interface QorexEncodedMessage {
  readonly typeUrl: string;
  /** Protobuf bytes: base64 string, `Uint8Array` or `number[]`. */
  readonly value: string | Uint8Array | number[];
}

/** `signAndBroadcast` request. */
export interface QorexSignAndBroadcastRequest {
  /** Must equal the network selected in QoreX. */
  readonly chainId: string;
  /** 1 to 32 messages. */
  readonly messages: readonly QorexEncodedMessage[];
  /** At most 256 bytes (UTF-8). */
  readonly memo?: string;
  /** Gas hint, clamped by QoreX to 100,000 to 5,000,000; 400,000 when absent. */
  readonly gasLimit?: number | string;
}

/** `signAndBroadcast` result. */
export interface QorexSignAndBroadcastResult {
  /** Hex transaction hash. */
  readonly txHash: string;
  /** Result code; 0 is success. */
  readonly code: number;
  /** Block height, when the transaction was included before QoreX returned. */
  readonly height?: number;
  /** Whether the committed transaction carries the hybrid ML-DSA-87 layer. See `QorexShieldState`. */
  readonly shield: QorexShieldState | (string & {});
}

/**
 * Result of QoreX re-reading the committed transaction:
 * - `shielded`: the hybrid ML-DSA-87 signature layer is in the committed transaction.
 * - `pending`: broadcast done, the check has not completed.
 * - `downgraded`: committed without the layer; treat as an alert.
 * - `classical`: a lane where the layer does not apply.
 */
export type QorexShieldState = "shielded" | "pending" | "downgraded" | "classical";

/** Minimal chain description for `experimentalSuggestChain`. QoreX reads only `chainId`. */
export interface QorexSuggestChainInput {
  readonly chainId: string;
  readonly [key: string]: unknown;
}

/** One account in the wallet. */
export interface QorexAccountSummary {
  readonly index: number;
  readonly label: string;
  /** `qor1...` address. */
  readonly address: string;
}

/**
 * The QoreX native provider (`window.qorex.native`): the QoreChain lane, in
 * the Keplr pattern. QoreX does not alias `window.keplr`.
 *
 * Chain ids: QoreX 0.3.x accepts `qorechain-vladi` and `qorechain-diana` only.
 * `enable`, `getKey` and `signDirect` reject any other chain id with
 * "QoreX: unsupported chain <id>". Signing is also bound to the network the
 * user selected in the wallet.
 *
 * Not provided: `getOfflineSigner`, `getOfflineSignerAuto`, `signAmino`,
 * `sendTx` and a keystore-change event.
 */
export interface QorexNativeProvider {
  readonly isQoreX: true;

  /** What this build can do. Test with `hasCapability` instead of comparing versions. */
  readonly capabilities: readonly string[];

  /** Asks the user to connect the site. Resolves `null`. */
  enable(chainId: string): Promise<void | null>;

  /** The active account. Connects the site first if needed. */
  getKey(chainId: string): Promise<QorexKey>;

  /**
   * Keplr-pattern SIGN_MODE_DIRECT: signs the SignDoc the page built, as is,
   * with the account's secp256k1 key.
   *
   * On QoreChain the transaction body must already carry a valid hybrid
   * ML-DSA-87 (FIPS 204) signature layer for the signer's registered key, and
   * only the wallet holds that key, so a page cannot build it. For QoreChain
   * transactions use `signAndBroadcast`.
   *
   * Planned: a future QoreX release declaring the `signDirectAddsPqcLayer`
   * capability adds the layer itself when the SignDoc has none. It then
   * re-estimates gas and may raise the gas limit and fee, so the returned
   * `signed` document (`authInfoBytes`, possibly `bodyBytes`) can differ from
   * the one sent; broadcast the returned document, never the original.
   *
   * Also refused: messages that manage the account's ML-DSA-87 key, more
   * messages than QoreX can show, and accounts created as Ethereum-type
   * (coin type 60) accounts.
   */
  signDirect(signerAddress: string, signDoc: QorexSignDocInput): Promise<QorexSignDirectResponse>;

  /**
   * The QoreChain path for a dApp transaction: the page sends the messages;
   * QoreX shows them, sets the fee, adds the hybrid secp256k1 + ML-DSA-87
   * (FIPS 204) signature and broadcasts.
   *
   * Refused: messages that manage the account's ML-DSA-87 key (wallet only,
   * also inside `MsgExec`) and message types QoreX cannot display.
   * Requires the `signAndBroadcast` capability.
   */
  signAndBroadcast(request: QorexSignAndBroadcastRequest): Promise<QorexSignAndBroadcastResult>;

  /**
   * ADR-36 arbitrary signing. Present but refused in current builds:
   * rejects with "QoreX: signArbitrary not yet supported" before any prompt.
   */
  signArbitrary(chainId: string, signer: string, data: string | Uint8Array): Promise<never>;

  /**
   * Resolves for `qorechain-*` chain ids (built in, no change). Any other
   * chain rejects with code 4902.
   */
  experimentalSuggestChain(chainInfo: QorexSuggestChainInput): Promise<void | null>;

  /**
   * Dashboard only: accepted from https://dashboard.qorechain.io and refused
   * for every other origin. Signs the Connect-with-QoreX pairing proof.
   */
  connectProof(sessionId: string): Promise<{ qorAddress: string; pubkeyHex: string; sigHex: string }>;

  /**
   * Dashboard only: accepted from https://dashboard.qorechain.io and refused
   * for every other origin. Executes a QOR transfer the dashboard proposed.
   */
  executeTransfer(request: {
    to: string;
    amountUqor: string;
    memo?: string;
  }): Promise<{ txHash: string; shield: QorexShieldState | (string & {}) }>;

  /**
   * Dashboard only: accepted from https://dashboard.qorechain.io and refused
   * for every other origin. Executes a composed send, delegate, undelegate,
   * redelegate or claim request. Requires the `executeRequest` capability.
   */
  executeRequest(params: { request: unknown }): Promise<{ txHash: string; shield: QorexShieldState | (string & {}) }>;

  /**
   * Every account in the wallet, read only. The site must be connected.
   * Requires the `listAccounts` capability.
   */
  listAccounts(): Promise<{ accounts: QorexAccountSummary[]; activeIndex: number }>;
}

// Solana ---------------------------------------------------------------------

/**
 * `window.qorex.svm`: a small Solana shim. Prefer the Wallet Standard wallet
 * QoreX registers (`QorexSolanaStandardWallet`). Both serve Solana itself;
 * the QoreChain SVM lane is not open yet.
 */
export interface QorexSvmProvider {
  readonly isQoreX: true;
  /** Connects the site; returns the base58 public key. */
  connect(): Promise<{ publicKey: string }>;
  /** Signs and sends a serialized transaction (wire bytes); returns the base58 signature. */
  signAndSendTransaction(transaction: QorexBytesInput): Promise<{ signature: string; publicKey: string }>;
  /** Signs a message (1 to 4096 bytes; transaction bytes are refused). */
  signMessage(message: QorexBytesInput): Promise<{ signature: number[]; publicKey: string }>;
}

/** Wallet Standard chain QoreX declares. */
export const QOREX_SOLANA_CHAINS = ["solana:mainnet"] as const;

/** Wallet Standard features QoreX declares, wallet level. */
export const QOREX_SOLANA_FEATURES = [
  "standard:connect",
  "standard:disconnect",
  "standard:events",
  "solana:signAndSendTransaction",
  "solana:signTransaction",
  "solana:signMessage",
] as const;

/** Account features QoreX declares. `solana:signIn` is not declared. */
export const QOREX_SOLANA_ACCOUNT_FEATURES = [
  "solana:signAndSendTransaction",
  "solana:signTransaction",
  "solana:signMessage",
] as const;

/** Wallet Standard account QoreX exposes. */
export interface QorexSolanaWalletAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly (typeof QOREX_SOLANA_CHAINS)[number][];
  readonly features: readonly (typeof QOREX_SOLANA_ACCOUNT_FEATURES)[number][];
}

/** Transaction versions QoreX accepts. */
export type QorexSolanaTransactionVersion = "legacy" | 0;

/** Solana Wallet Standard wallet QoreX registers (`wallet-standard:register-wallet`). */
export interface QorexSolanaStandardWallet {
  readonly version: "1.0.0";
  readonly name: "QoreX";
  readonly icon: string;
  readonly chains: readonly (typeof QOREX_SOLANA_CHAINS)[number][];
  readonly accounts: readonly QorexSolanaWalletAccount[];
  readonly features: {
    readonly "standard:connect": {
      readonly version: "1.0.0";
      connect(): Promise<{ accounts: readonly QorexSolanaWalletAccount[] }>;
    };
    readonly "standard:disconnect": { readonly version: "1.0.0"; disconnect(): Promise<void> };
    readonly "standard:events": {
      readonly version: "1.0.0";
      /** Only `change` is emitted, on connect and disconnect. */
      on(
        event: "change",
        listener: (properties: { accounts?: readonly QorexSolanaWalletAccount[] }) => void,
      ): () => void;
    };
    readonly "solana:signAndSendTransaction": {
      readonly version: "1.0.0";
      readonly supportedTransactionVersions: readonly QorexSolanaTransactionVersion[];
      signAndSendTransaction(
        ...inputs: ReadonlyArray<{ transaction: Uint8Array }>
      ): Promise<Array<{ signature: Uint8Array }>>;
    };
    readonly "solana:signTransaction": {
      readonly version: "1.0.0";
      readonly supportedTransactionVersions: readonly QorexSolanaTransactionVersion[];
      signTransaction(
        ...inputs: ReadonlyArray<{ transaction: Uint8Array }>
      ): Promise<Array<{ signedTransaction: Uint8Array }>>;
    };
    readonly "solana:signMessage": {
      readonly version: "1.0.0";
      signMessage(
        ...inputs: ReadonlyArray<{ message: Uint8Array }>
      ): Promise<Array<{ signedMessage: Uint8Array; signature: Uint8Array }>>;
    };
  };
}

// window.qorex -----------------------------------------------------------------

/** What QoreX writes to `window.qorex`. */
export interface QorexInjected {
  readonly evm: QorexEip1193Provider;
  readonly native: QorexNativeProvider;
  readonly svm: QorexSvmProvider;
}
