# @qorechain/qorex-wallet-mock

A test double of the QoreX wallet for jsdom, Vitest and Playwright. It injects the same objects QoreX injects (`window.qorex = { evm, native, svm }`), announces itself through EIP-6963 and registers a Solana Wallet Standard wallet. Signing is real: hybrid secp256k1 + ML-DSA-87 (FIPS 204) through QoreSign on the QoreChain native lane, secp256k1 on EVM, ed25519 on Solana.

```bash
npm install -D @qorechain/qorex-wallet-mock
```

It announces as **QoreX (mock)** with rdns `network.qore.qorex.mock`, so it is never taken for the wallet. Code that selects QoreX strictly by `network.qore.qorex` sees the mock through `window.qorex.evm` (every provider has `isQoreX: true`).

## Playwright

```ts
import { createQorexMock } from "@qorechain/qorex-wallet-mock";

const mock = createQorexMock({ profile: "current" });
await page.addInitScript({ content: mock.initScript() });
await page.goto("http://localhost:5173");
await page.evaluate(() => window.__qorexMock!.rejectNext());
```

`initScript()` returns one self-contained script (QoreSign and every other dependency inside; Node 20.16 or later). `@qorechain/qorex-synpress` wraps this in a fixture.

## jsdom and Vitest

```ts
const mock = createQorexMock({ profile: "planned" });
mock.install(window);
const [account] = await window.qorex!.evm.request({ method: "eth_requestAccounts" });
mock.rejectNext();
```

## Options

| Option | Default | |
|---|---|---|
| `profile` | `"current"` | `"current"`: what QoreX does today. `"planned"`: adds what QoreX has announced. |
| `mnemonic` | BIP-39 test mnemonic (`abandon ... about`) | public; use your own for anything you fund |
| `accountIndex` | `0` | same index on every lane |
| `chainId` | `"qorechain-diana"` | network selected in the mock |
| `rest` | `https://api-testnet.qore.host` | REST endpoint for `signAndBroadcast` and key lookups |
| `evmRpc` | `https://evm-testnet.qore.host` | used by `eth_sendTransaction` (planned) |
| `allowMainnet` | `false` | without it, signing for `qorechain-vladi` is refused |
| `autoApprove` | `true` | when `false`, each approval waits for `approveNext()` / `rejectNext()` |
| `inclusionTimeoutMs`, `pollIntervalMs` | `30000`, `1500` | how `signAndBroadcast` waits for inclusion |
| `fetch` | global `fetch` | `install()` only |

Accounts are derived as QoreX derives them: `m/44'/118'/0'/0/i` with the canonical ML-DSA-87 key of that `qor1` address, `m/44'/60'/0'/0/i` for EVM, `m/44'/501'/i'/0'` (SLIP-10) for Solana.

## Control

`install()` returns, and the page gets as `window.__qorexMock`:

| | |
|---|---|
| `approveNext()`, `rejectNext()` | answer the next approval, or the one waiting |
| `pendingApprovals` | approvals waiting (with `autoApprove: false`) |
| `requests`, `clearRequests()` | every call: method, params as JSON, approval, outcome, result or error |
| `switchAccount(i)`, `switchNetwork(chainId)` | change the selection; events only in the planned profile |
| `disconnect()` | forget the site connection |
| `addresses()` | `{ native, evm, svm }` |

The site connection is shared by the three lanes, as in QoreX: the first `eth_requestAccounts`, `enable`, `getKey` or Solana `connect` asks for it.

## Profiles

| | `current` (QoreX today) | `planned` (announced) |
|---|---|---|
| `eth_chainId`, `eth_accounts`, `eth_requestAccounts` | yes | yes |
| `wallet_switchEthereumChain` | active chain only; others 4902 | same |
| other EVM methods | "QoreX: EVM method X not yet supported", no code | same text, code 4200 |
| `personal_sign`, `eth_signTypedData_v4` | refused as above | signed (EIP-191, EIP-712) |
| `eth_sendTransaction` | refused as above | signed and sent to `evmRpc` |
| `wallet_addEthereumChain` | refused as above | `null` for 0x2648 / 0x2649, otherwise 4902 |
| `accountsChanged`, `chainChanged` | never emitted | emitted on connect and on `switchAccount` / `switchNetwork` |
| `native.signAndBroadcast` | hybrid signed and broadcast | same |
| `native.signDirect` | needs a valid hybrid layer already in the body | also adds the layer itself when there is none |
| `native.getOfflineSigner` | absent | present (direct signer over `signDirect`) |
| `native.signArbitrary` | "QoreX: signArbitrary not yet supported" | message-signing-v1 (ADR-36 + ML-DSA-87) |
| `native.capabilities` | QoreX's list | adds `signDirectAddsPqcLayer` |
| Solana | connect, `signMessage`, `signTransaction` | same |

### `signAndBroadcast`

Validates the request as QoreX does (1 to 32 messages, memo up to 256 bytes, wallet-only PQC key messages refused, chain must be the selected one), asks for approval, then:

1. reads the account's ML-DSA-87 key from REST; when none is registered it first sends a `MsgRegisterPQCKeyV2` transaction (register once), as QoreX does;
2. signs hybrid with QoreSign, gas from the hint clamped to 100,000 to 5,000,000 (400,000 when absent), fee 0.15 uqor per gas;
3. broadcasts, retrying once with the other sign-bytes version when the network asks for it;
4. waits for inclusion and returns `{ txHash, code, height, shield }`, `shield` being `shielded` when the committed transaction carries the layer.

### Planned `signDirect`

When the body has no hybrid layer, the mock checks that the account's registered key is its own, adds the layer with QoreSign `signPqLayer` and returns the new `bodyBytes`. It does not simulate: if the SignDoc's gas limit is below 400,000 it raises it to 400,000 and the uqor fee to at least 0.15 uqor per gas, and only then returns changed `authInfoBytes`. Broadcast the returned `signed` document.

### Differences from QoreX

- No lock screen, no approval window: approvals are `approveNext` / `rejectNext` / `autoApprove`.
- `signDirect` reports `pub_key.type` as `/cosmos.crypto.secp256k1.PubKey`.
- `signAndBroadcast` does not decode messages to refuse those QoreX cannot display.
- Where QoreX has an answer today the mock uses QoreX's message, except two reworded ones: the refusal of a SignDoc without the layer and of a foreign chain in `experimentalSuggestChain`. Messages that start with `QoreX (mock):` are the mock's own, and the planned profile's messages for new situations are the mock's best guess.
- Solana `signAndSendTransaction` is refused: the mock never sends to Solana.
- `eth_sendTransaction` (planned) does not open the EVM authorization window QoreChain requires; the node's answer is returned as is.
- Mainnet is refused unless `allowMainnet: true`.

Apache-2.0. Copyright 2026 QoreChain Association.
