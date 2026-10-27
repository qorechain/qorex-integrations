# Errors and chain ids

## Chain ids and endpoints

| | Mainnet | Testnet |
|---|---|---|
| Native chain id | `qorechain-vladi` | `qorechain-diana` |
| EVM chain id | 9801 (`0x2649`) | 9800 (`0x2648`) |
| REST | `https://api.qore.host` | `https://api-testnet.qore.host` |
| RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| EVM JSON-RPC | `https://evm.qore.host` | `https://evm-testnet.qore.host` |
| Explorer | `https://explore.qore.network` | `https://explore.qore.network` |

Bech32 prefix `qor` (validators `qorvaloper`), coin type 118, denom `uqor` with 6 decimals on the native lane, QOR with 18 decimals on EVM. Minimum gas price on the native lane: 0.1 uqor; QoreX prices its own transactions at 0.15 uqor per gas.

QoreX accepts only `qorechain-vladi` and `qorechain-diana` on the native provider. Its Solana wallet serves `solana:mainnet`. QoreChain's own SVM lane is not open yet and has no Wallet Standard chain id; do not make one up.

## How to read an error

QoreX errors are plain `Error` objects whose `message` starts with `QoreX` and that sometimes carry a numeric `code`. Check `code` first, then fall back to the message text:

```ts
import { isQorexUnrecognizedChainError, isQorexUnsupportedMethodError } from "@qorechain/qorex-types";

try {
  await provider.request({ method: "personal_sign", params: [message, account] });
} catch (err) {
  if (isQorexUnsupportedMethodError(err)) showFallback(); // code 4200 (planned) or today's message
  else if (isQorexUnrecognizedChainError(err)) askToSwitchInWallet(); // code 4902
  else throw err;
}
```

Today only an unknown chain (4902) carries a code. A future QoreX release is planned to add code 4200 to every EVM method it does not answer and 4902 to every unknown chain, with the same message text, so code that checks `code` first and the text second works with both.

## EVM provider

| Situation | `message` | `code` today | `code` planned |
|---|---|---|---|
| method QoreX does not answer | `QoreX: EVM method <name> not yet supported` | none | 4200 |
| `wallet_switchEthereumChain` to another chain | `QoreX: unrecognized chain <hex>` | 4902 | 4902 |
| `wallet_addEthereumChain` for an unknown chain | (not answered today) | none | 4902 |
| user rejects the connection | `QoreX: connection rejected` | none | none announced |
| user rejects a signature | `QoreX: signature rejected` | none | none announced |
| wallet locked | `QoreX: wallet is locked` | none | none announced |

A user rejection has no EIP-1193 4001 code; match the message.

Methods answered today: `eth_chainId`, `eth_accounts`, `eth_requestAccounts`, `wallet_switchEthereumChain` (active chain). Planned: `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`, `wallet_addEthereumChain`, and the `accountsChanged` / `chainChanged` events.

## QoreChain native provider

| Situation | `message` | `code` |
|---|---|---|
| user rejects the connection | `QoreX: connection rejected` | none |
| user rejects a signature | `QoreX: signature rejected` | none |
| chain id other than QoreChain | `QoreX: unsupported chain <id>` | none |
| chain id differs from the network selected in QoreX | `QoreX: chain <id> does not match the active network <id>` (`signAndBroadcast`), `QoreX: signature chain <id> does not match the active network <id>` (`signDirect`) | none |
| signer is not the active account | `QoreX: unknown signer address` | none |
| no messages or more than 32 | `QoreX: send between 1 and 32 messages` | none |
| memo over 256 bytes | `QoreX: the memo may be at most 256 bytes` | none |
| a message that manages the account's ML-DSA-87 key | `QoreX: <typeUrl> is managed by the wallet itself, not by a website` | none |
| `signDirect` on QoreChain without a valid hybrid layer | starts with `QoreX refused to sign:` | none |
| suggesting a foreign chain | starts with `QoreX supports QoreChain networks only` | 4902 |
| `signArbitrary` | `QoreX: signArbitrary not yet supported` | none |
| dashboard-only methods on another site | `QoreX: this method is available to the QoreChain dashboard only` | none |
| committed with a non-zero code | `Transaction failed on-chain (code <n>).` | none |

Amino signing is not offered, by design: Amino JSON cannot carry the hybrid ML-DSA-87 signature.

## Solana

| Situation | `message` |
|---|---|
| user rejects | `QoreX: connection rejected` / `QoreX: signature rejected` |
| empty or over 4096-byte message | `QoreX: invalid message length` |
| message that is a Solana transaction | `QoreX: refusing to sign transaction bytes as a message` |

## Errors from the qorex-integrations packages

`QorexIntegrationError`, test `code` with `isQorexIntegrationError(err, code)`:

| `code` | When |
|---|---|
| `QOREX_NOT_INSTALLED` | no QoreX in the page |
| `QOREX_USE_SIGN_AND_BROADCAST` | a signer-based transaction on QoreChain; send the messages with `signAndBroadcast` |
| `QOREX_AMINO_REFUSED` | any Amino signing |
| `QOREX_NOT_SUPPORTED_YET` | something QoreX does not offer yet |

`QorexExtensionModeUnavailableError` (`code` `QOREX_EXTENSION_MODE_UNAVAILABLE`) from `@qorechain/qorex-synpress`: extension mode needs stable `data-testid` selectors in QoreX.

## Errors from the wallet mock

Messages that start with `QoreX (mock):` come from `@qorechain/qorex-wallet-mock`, never from QoreX:

| `message` | When |
|---|---|
| `QoreX (mock): qorechain-vladi (mainnet) is refused. ...` | signing for mainnet without `allowMainnet: true` |
| `QoreX (mock): the mock does not send Solana transactions. ...` | Solana `signAndSendTransaction` |
