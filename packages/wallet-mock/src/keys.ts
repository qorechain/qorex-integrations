// SPDX-License-Identifier: Apache-2.0
//
// Deterministic accounts, derived the way QoreX derives them:
// - QoreChain native: secp256k1 at m/44'/118'/0'/0/{i}, bech32 `qor`, and the
//   canonical ML-DSA-87 key of that address;
// - EVM: secp256k1 at m/44'/60'/0'/0/{i};
// - Solana: ed25519 (SLIP-10) at m/44'/501'/{i}'/0'.

import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  addressFromPublicKey,
  deriveCanonicalPqKey,
  deriveClassicalKey,
  toHex,
  type ClassicalKey,
  type PqKeyPair,
} from "@qorechain/qoresign";
import { base58 } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";
import { utf8 } from "./util.js";

/** The BIP-39 test mnemonic. Public: never fund it on mainnet. */
export const PUBLIC_TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export interface NativeAccount {
  key: ClassicalKey;
  /** `qor1...` */
  address: string;
}

export interface EvmAccount {
  /** 0x-prefixed hex private key. */
  privateKey: `0x${string}`;
  /** EIP-55 address. */
  address: `0x${string}`;
}

export interface SvmAccount {
  /** 32-byte ed25519 seed. */
  seed: Uint8Array;
  publicKey: Uint8Array;
  /** Base58 public key. */
  address: string;
}

function slip10Ed25519(seed: Uint8Array, path: readonly number[]): Uint8Array {
  let I = hmac(sha512, utf8("ed25519 seed"), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  for (const index of path) {
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0, false);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

/** Lazily derived keys for one account index of one mnemonic. */
export class MockAccount {
  private nativeCache?: NativeAccount;
  private evmCache?: EvmAccount;
  private svmCache?: SvmAccount;
  private pqCache?: PqKeyPair;

  constructor(
    private readonly mnemonic: string,
    readonly index: number,
  ) {}

  get native(): NativeAccount {
    if (!this.nativeCache) {
      const key = deriveClassicalKey({ mnemonic: this.mnemonic, index: this.index });
      this.nativeCache = { key, address: addressFromPublicKey(key.publicKey, "secp256k1").bech32 };
    }
    return this.nativeCache;
  }

  /** The canonical ML-DSA-87 key of the native address (the one QoreX registers). */
  get pq(): PqKeyPair {
    this.pqCache ??= deriveCanonicalPqKey({ mnemonic: this.mnemonic, address: this.native.address });
    return this.pqCache;
  }

  get evm(): EvmAccount {
    if (!this.evmCache) {
      const key = deriveClassicalKey({ mnemonic: this.mnemonic, type: "eth_secp256k1", index: this.index });
      this.evmCache = {
        privateKey: `0x${toHex(key.privateKey)}`,
        address: addressFromPublicKey(key.publicKey, "eth_secp256k1").hex as `0x${string}`,
      };
    }
    return this.evmCache;
  }

  get svm(): SvmAccount {
    if (!this.svmCache) {
      const seed = slip10Ed25519(mnemonicToSeedSync(this.mnemonic), [44, 501, this.index, 0]);
      const publicKey = ed25519.getPublicKey(seed);
      this.svmCache = { seed, publicKey, address: base58.encode(publicKey) };
    }
    return this.svmCache;
  }
}
