# Already support MetaMask? Add QoreX in 5 lines

QoreX exposes a standard EIP-1193 provider and announces it through EIP-6963. It never writes `window.ethereum`, so pick it by its rdns.

## Detect

With `@qorechain/qorex-types`:

```ts
import { discoverQorexEip1193 } from "@qorechain/qorex-types";

const qorex = await discoverQorexEip1193({ timeoutMs: 500 }); // undefined when not installed
if (qorex) {
  const [account] = (await qorex.request({ method: "eth_requestAccounts" })) as string[];
}
```

Without dependencies:

```ts
let qorex;
window.addEventListener("eip6963:announceProvider", (e) => {
  if (e.detail?.info?.rdns === "network.qore.qorex") qorex = e.detail.provider;
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
```

The same provider is also at `window.qorex.evm`. EIP-6963 announcements are not authenticated; any extension can claim an rdns.

With RainbowKit, use `@qorechain/qorex-rainbowkit`:

```ts
wallets: [qorexWallet, metaMaskWallet]
```

With plain wagmi, `multiInjectedProviderDiscovery` (on by default) already lists QoreX under the id `network.qore.qorex`.

## What QoreX answers today

| Method | Behaviour |
|---|---|
| `eth_chainId` | `0x2649` (9801, mainnet) or `0x2648` (9800, testnet): the network selected in QoreX. Answers while locked. |
| `eth_accounts` | `[address]` when unlocked and the site is connected, otherwise `[]` |
| `eth_requestAccounts` | asks the user to connect the site, then `[address]` |
| `wallet_switchEthereumChain` | resolves `null` for the active chain; any other chain rejects with code 4902 |
| `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`, `wallet_addEthereumChain`, others | not supported yet: rejects with "QoreX: EVM method <name> not yet supported" |

The user changes network inside QoreX; a dApp cannot switch it.

## Events

`on` and `removeListener` exist, but QoreX does not emit `accountsChanged`, `chainChanged`, `connect` or `disconnect` yet. Re-read `eth_accounts` and `eth_chainId` when the page regains focus. `@qorechain/qorex-rainbowkit` does this for wagmi with `qorexWallet({ pollAccountsOnFocus: true })`.

## Errors

Errors are plain `Error` objects; most carry no numeric code.

| Situation | `message` | `code` |
|---|---|---|
| user rejects the connection | `QoreX: connection rejected` | none |
| wallet locked | `QoreX: wallet is locked` | none |
| switch to a chain other than the active one | `QoreX: unrecognized chain <hex>` | 4902 |
| unsupported method | `QoreX: EVM method <name> not yet supported` | none |

A user rejection does not carry EIP-1193 code 4001 yet; match the message.

Planned for a future QoreX release: code 4200 on every method QoreX does not answer and 4902 on unknown chains, next to the same message text. Check `code` first and fall back to the message, for example with `isQorexUnsupportedMethodError` and `isQorexUnrecognizedChainError` from `@qorechain/qorex-types`. See [errors-and-chain-ids.md](errors-and-chain-ids.md).

## Chain ids and endpoints

| | Mainnet | Testnet |
|---|---|---|
| EVM chain id | 9801 (`0x2649`) | 9800 (`0x2648`) |
| EVM JSON-RPC | `https://evm.qore.host` | `https://evm-testnet.qore.host` |
| Native chain id | `qorechain-vladi` | `qorechain-diana` |
| REST | `https://api.qore.host` | `https://api-testnet.qore.host` |
| RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| Explorer | `https://explore.qore.network` | `https://explore.qore.network` |

Currency: QOR, 18 decimals on EVM (`uqor` with 6 decimals on the native lane). Minimum gas price on the native lane: 0.1 uqor.

## The EVM rule on QoreChain

An EVM transaction is accepted only when the sender has a registered ML-DSA-87 key and an open EVM authorization window, both opened from the native lane. Without them the chain rejects the transaction, whatever wallet signed it. QoreX registers the key and opens the window from its own interface.
