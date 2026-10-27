# @qorechain/qorex-types

TypeScript types and detection helpers for what the QoreX wallet injects into a page: an EIP-1193 provider announced through EIP-6963, the QoreChain native provider at `window.qorex.native`, and a Solana Wallet Standard wallet. No runtime dependencies.

```bash
npm install @qorechain/qorex-types
```

```ts
import { discoverQorexEip1193, getQorexNative, hasCapability, QOREX_RDNS } from "@qorechain/qorex-types";

// EVM: EIP-6963, picked by rdns "network.qore.qorex". QoreX never writes window.ethereum.
const evm = await discoverQorexEip1193({ timeoutMs: 500 });

// QoreChain native lane (Keplr pattern, no window.keplr alias).
const native = getQorexNative();
if (native && hasCapability(native, "signAndBroadcast")) {
  const { txHash, code, shield } = await native.signAndBroadcast({ chainId: "qorechain-diana", messages });
}
```

Importing the package also types `window.qorex`:

```ts
window.qorex?.native.getKey("qorechain-vladi");
```

| Export | What it is |
|---|---|
| `QorexEip1193Provider`, `QorexEip6963ProviderDetail`, `QOREX_RDNS` | EVM provider and its EIP-6963 announcement |
| `QorexNativeProvider` | every method on `window.qorex.native`, with what QoreX accepts and refuses |
| `QorexSolanaStandardWallet`, `QorexSvmProvider` | the Solana Wallet Standard wallet and the `window.qorex.svm` shim |
| `discoverQorexEip1193`, `findQorexEip1193` | EIP-6963 discovery (async with timeout, or synchronous probe) |
| `getQorexNative`, `isQorexInstalled`, `hasCapability` | `window.qorex` helpers |
| `qorexSignAndBroadcast` | the QoreChain path for a dApp transaction |
| `QorexIntegrationError`, `isQorexIntegrationError` | errors thrown by the qorex-integrations packages, with stable codes |
| `isQorexUnsupportedMethodError`, `isQorexUnrecognizedChainError`, `QOREX_EVM_ERROR_CODES` | classify QoreX EVM refusals: `code` first (4200 and 4902, planned for every refusal), then today's message text |
| `QOREX_MOCK_RDNS`, `QOREX_MOCK_NAME` | what `@qorechain/qorex-wallet-mock` announces, so a test double is never taken for QoreX |
| `@qorechain/qorex-types/icon` | the QoreX icon as a data URI |

What QoreX does today, in short:

- **EVM:** answers `eth_chainId`, `eth_accounts`, `eth_requestAccounts` and `wallet_switchEthereumChain` (active chain only). Signing methods are not supported yet. No `accountsChanged` or `chainChanged` events yet. Refusals are plain messages; only an unknown chain in `wallet_switchEthereumChain` carries code 4902. Planned: events, code 4200 or 4902 on every refusal (same message text), then `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` and `wallet_addEthereumChain`.
- **Native:** `enable`, `getKey`, `signDirect`, `signAndBroadcast`, `listAccounts`, `experimentalSuggestChain`. Chain ids `qorechain-vladi` and `qorechain-diana` only. On QoreChain, `signDirect` needs the hybrid ML-DSA-87 (FIPS 204) layer to be present already, which a page cannot build: use `signAndBroadcast`. `signArbitrary` is refused for now. No Amino, no `sendTx`.
- **Solana:** Wallet Standard on `solana:mainnet` with connect, disconnect, events, `signAndSendTransaction`, `signTransaction` and `signMessage`. No `solana:signIn`.

Guides and the other packages: <https://github.com/qorechain/qorex-integrations>.

Apache-2.0. Copyright 2026 QoreChain Association.
