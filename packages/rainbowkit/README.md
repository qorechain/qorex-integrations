# @qorechain/qorex-rainbowkit

QoreX as a RainbowKit wallet, plus viem chain definitions for the QoreChain EVM lane.

```bash
npm install @qorechain/qorex-rainbowkit @rainbow-me/rainbowkit wagmi viem @tanstack/react-query
```

```ts
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { QOREX_CHAINS, qorechain, qorechainTestnet, qorexWallet } from "@qorechain/qorex-rainbowkit";

const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets: [qorexWallet, metaMaskWallet] }],
  { appName: "My dApp", projectId: "<walletconnect project id>" },
);

export const config = createConfig({
  chains: QOREX_CHAINS,
  connectors,
  transports: { [qorechain.id]: http(), [qorechainTestnet.id]: http() },
});
```

- `qorexWallet()` returns a RainbowKit `Wallet` (id `qorex`, rdns `network.qore.qorex`). Its connector is wagmi's injected connector pinned to the provider QoreX announces through EIP-6963; it never falls back to `window.ethereum`. When QoreX is not installed, RainbowKit shows the store links.
- `QOREX_CHAINS` is `[qorechain, qorechainTestnet]`: EVM chain ids 9801 and 9800, RPC `https://evm.qore.host` and `https://evm-testnet.qore.host`, native currency QOR with 18 decimals, explorer `https://explore.qore.network`.

## Account and network changes

QoreX does not emit `accountsChanged` or `chainChanged` yet, so wagmi does not see a change made in the wallet. Opt in to a re-read when the page regains focus:

```ts
wallets: [() => qorexWallet({ pollAccountsOnFocus: true })]
```

While connected, the connector reads `eth_accounts` and `eth_chainId` on `focus` and `visibilitychange` and reports a change to wagmi. An empty account list (wallet locked or site disconnected) disconnects.

## What QoreX answers on EVM today

`eth_chainId`, `eth_accounts`, `eth_requestAccounts`, and `wallet_switchEthereumChain` for the network selected in QoreX (others reject with code 4902). Signing methods such as `personal_sign`, `eth_signTypedData_v4` and `eth_sendTransaction`, and `wallet_addEthereumChain`, are not supported yet and reject with "QoreX: EVM method ... not yet supported".

On QoreChain, an EVM transaction is accepted only when the sender has a registered ML-DSA-87 key and an open EVM authorization window, both set up from the native lane.

Guides: <https://github.com/qorechain/qorex-integrations>.

Apache-2.0. Copyright 2026 QoreChain Association.
