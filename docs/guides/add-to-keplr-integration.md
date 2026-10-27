# Already support Keplr? Add QoreX in 3 lines

QoreX's native provider follows the Keplr pattern at `window.qorex.native`. It does not alias `window.keplr`, and on QoreChain transactions go through `signAndBroadcast`, not a page-built SignDoc.

## Detect

```ts
const qorex = window.qorex?.native; // undefined when not installed
await qorex.enable("qorechain-vladi");
const key = await qorex.getKey("qorechain-vladi"); // { bech32Address, pubKey: number[], address: number[], algo, isNanoLedger }
```

`pubKey` and `address` arrive as `number[]`; convert with `Uint8Array.from(key.pubKey)`.

With a kit:

- Interchain Kit (actively maintained, preferred): `@qorechain/qorex-interchain-kit`, `wallets={[qorexWallet]}`.
- cosmos-kit: `@qorechain/qorex-cosmos-kit`, `wallets={[...wallets]}`.

Both convert the key bytes, synthesize the offline signer, and expose `qorexSignAndBroadcast`.

## Sending a transaction on QoreChain

QoreChain requires a hybrid secp256k1 + ML-DSA-87 (FIPS 204) signature by default. Only the wallet holds the ML-DSA-87 key, so a page cannot build a valid SignDoc. Send the messages and let QoreX build, sign and broadcast:

```ts
import { qorexSignAndBroadcast } from "@qorechain/qorex-interchain-kit";

const { txHash, code, height, shield } = await qorexSignAndBroadcast({
  chainId: "qorechain-vladi",
  messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: MsgSend.encode(msg).finish() }],
  memo: "",
  gasLimit: 200000,
});
```

Without a package: `window.qorex.native.signAndBroadcast(request)`; check `window.qorex.native.capabilities.includes("signAndBroadcast")` first.

- `value` is the protobuf-encoded message: `Uint8Array`, `number[]` or base64.
- 1 to 32 messages; memo up to 256 bytes; `gasLimit` is clamped to 100,000 to 5,000,000 (400,000 when omitted). QoreX sets the fee and shows it before signing.
- `chainId` must match the network selected in QoreX.
- Messages that manage the account's ML-DSA-87 key are wallet only and refused, also inside `MsgExec`. Message types QoreX cannot display are refused.
- `shield` is `"shielded"` once QoreX has confirmed the committed transaction carries the hybrid layer.

Planned for a future QoreX release: `signDirect` on QoreChain will add the ML-DSA-87 layer itself when the SignDoc has none, for accounts with a registered ML-DSA-87 key. QoreX will then re-estimate gas and may raise the gas limit and fee, so the returned `signed.authInfoBytes` can differ from what the page sent: always broadcast the returned `signed` document. QoreX will declare the capability `signDirectAddsPqcLayer` when this is available; the kit packages switch the offline signer on automatically when it is declared and keep refusing until then.

## What differs from Keplr

| Keplr | QoreX today |
|---|---|
| `window.keplr` | `window.qorex.native` |
| `getOfflineSigner`, `getOfflineSignerAuto` | not provided; the kit packages synthesize a direct signer from `getKey` and `signDirect` |
| `signDirect` | signs the SignDoc as is; on QoreChain the SignDoc must already carry the hybrid layer, so use `signAndBroadcast` |
| `signAmino`, `getOfflineSignerOnlyAmino` | not provided; refused by design: Amino JSON cannot carry the hybrid ML-DSA-87 signature |
| `signArbitrary` (ADR-36) | present but refused: "QoreX: signArbitrary not yet supported"; planned in a future QoreX version |
| `sendTx` | not provided; broadcast through your RPC endpoint, or use `signAndBroadcast` |
| `experimentalSuggestChain` | resolves for `qorechain-*` (built in); other chains reject with code 4902 |
| chains | `qorechain-vladi` and `qorechain-diana` only |

Methods `connectProof`, `executeTransfer` and `executeRequest` exist for the QoreChain dashboard only and are refused on every other origin.

## Events

QoreX emits no keystore-change event yet. Re-read `getKey` when the page regains focus.

## Errors

From QoreX (plain `Error`, match the message):

| Situation | `message` | `code` |
|---|---|---|
| user rejects the connection | `QoreX: connection rejected` | none |
| user rejects a signature | `QoreX: signature rejected` | none |
| wallet locked | `QoreX: wallet is locked` | none |
| chain id other than QoreChain | `QoreX: unsupported chain <id>` | none |
| chain id differs from the network selected in QoreX | `QoreX: ... does not match the active network ...` | none |
| suggesting a foreign chain | `QoreX supports QoreChain networks only ...` | 4902 |
| `signArbitrary` | `QoreX: signArbitrary not yet supported` | none |

From the kit packages (`QorexIntegrationError`, test `code`):

| `code` | When |
|---|---|
| `QOREX_USE_SIGN_AND_BROADCAST` | the offline signer was asked to sign on QoreChain |
| `QOREX_AMINO_REFUSED` | any Amino signing |
| `QOREX_NOT_SUPPORTED_YET` | `signArbitrary`, `verifyArbitrary`, `sendTx` |
| `QOREX_NOT_INSTALLED` | `qorexSignAndBroadcast` without QoreX |

## Chain ids and endpoints

| | Mainnet | Testnet |
|---|---|---|
| Chain id | `qorechain-vladi` | `qorechain-diana` |
| REST | `https://api.qore.host` | `https://api-testnet.qore.host` |
| RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| EVM JSON-RPC | `https://evm.qore.host` (9801) | `https://evm-testnet.qore.host` (9800) |
| Explorer | `https://explore.qore.network` | `https://explore.qore.network` |

Bech32 prefix `qor` (validators `qorvaloper`), coin type 118, denom `uqor` with 6 decimals on the native lane (18 on EVM), minimum gas price 0.1 uqor.
