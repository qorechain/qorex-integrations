# Already support Phantom? QoreX is already in your wallet list

QoreX registers a Solana wallet through the Wallet Standard. dApps built on `@solana/wallet-adapter` or `@wallet-standard/app` list it without any change.

QoreX's Solana wallet is for Solana itself (`solana:mainnet`). The QoreChain SVM lane is not open yet, so this wallet does not reach QoreChain.

## Detect

```ts
import { getWallets } from "@wallet-standard/app";

const qorex = getWallets().get().find((w) => w.name === "QoreX");
```

QoreX also exposes a small shim at `window.qorex.svm` (`connect`, `signAndSendTransaction`, `signMessage`); prefer the Wallet Standard wallet.

## What QoreX declares

| Item | Value |
|---|---|
| chains | `solana:mainnet` |
| `standard:connect`, `standard:disconnect`, `standard:events` | yes |
| `solana:signAndSendTransaction` | yes, versions `legacy` and `0` |
| `solana:signTransaction` | yes, versions `legacy` and `0` |
| `solana:signMessage` | yes, 1 to 4096 bytes; bytes that form a Solana transaction message are refused |
| `solana:signIn` (Sign In With Solana) | not declared |

Each signature is approved by the user in QoreX, with the transaction's instructions shown.

## Events

`standard:events` emits `change` with the account list on connect and disconnect. A change of account made inside QoreX is not emitted yet; reconnect or re-read `wallet.accounts` when the page regains focus.

## Errors

Errors are plain `Error` objects; match the message.

| Situation | `message` |
|---|---|
| user rejects the connection | `QoreX: connection rejected` |
| user rejects a signature | `QoreX: signature rejected` |
| wallet locked | `QoreX: wallet is locked` |
| message too short or too long | `QoreX: invalid message length` |
| transaction bytes passed to `signMessage` | `QoreX: refusing to sign transaction bytes as a message` |

## QoreChain chain ids and endpoints

For the QoreChain lanes QoreX does serve (native and EVM):

| | Mainnet | Testnet |
|---|---|---|
| Native chain id | `qorechain-vladi` | `qorechain-diana` |
| EVM chain id | 9801 | 9800 |
| REST | `https://api.qore.host` | `https://api-testnet.qore.host` |
| RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| EVM JSON-RPC | `https://evm.qore.host` | `https://evm-testnet.qore.host` |

Bech32 prefix `qor`, coin type 118, denom `uqor` (6 decimals native, 18 on EVM), minimum gas price 0.1 uqor. On the EVM lane a transaction is accepted only when the sender has a registered ML-DSA-87 key and an open EVM authorization window opened from the native lane. See the MetaMask and Keplr guides.
