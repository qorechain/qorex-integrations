# QoreX integrations

Packages, guides and test tooling for adding the [QoreX](https://www.qorechain.io) wallet to dApps: Ethereum-compatible apps (EIP-1193, EIP-6963, RainbowKit and wagmi), Cosmos apps (cosmos-kit, Interchain Kit) and Solana apps (Wallet Standard), plus QoreChain's own native lane.

## Packages

| Package | What it is |
|---|---|
| [`@qorechain/qorex-types`](packages/types) | Types for everything QoreX injects (`window.qorex`), EIP-6963 discovery, capability checks, error helpers |
| [`@qorechain/qorex-rainbowkit`](packages/rainbowkit) | QoreX as a RainbowKit wallet, plus viem chain definitions for the QoreChain EVM lane |
| [`@qorechain/qorex-interchain-kit`](packages/interchain-kit) | QoreX for Interchain Kit, with the QoreChain `signAndBroadcast` path |
| [`@qorechain/qorex-cosmos-kit`](packages/cosmos-kit) | QoreX for cosmos-kit, with the same path |
| [`@qorechain/qorex-wallet-mock`](packages/wallet-mock) | A test double of QoreX for jsdom and Playwright that signs for real (hybrid ML-DSA-87 on QoreChain's native lane via [QoreSign](https://github.com/qorechain/qoresign)) |
| [`@qorechain/qorex-synpress`](packages/synpress) | Playwright fixtures in the Synpress v4 style that install the mock wallet |

Each package is installed from npm, e.g. `npm install @qorechain/qorex-rainbowkit`.

## What QoreX supports today

| Surface | Today | Planned by the QoreX team |
|---|---|---|
| EVM (EIP-1193, announced through EIP-6963 as `network.qore.qorex`) | connect, accounts, chain id, switching to the selected network | events, EIP-1193 error codes, `personal_sign`, typed data, transactions, adding a chain |
| QoreChain native lane (`window.qorex.native`) | `enable`, `getKey`, `signAndBroadcast` (the wallet builds the transaction and signs it with both keys), `listAccounts` | `signDirect` adding the ML-DSA-87 layer itself, message signing (ADR-36 + ML-DSA-87) |
| Solana (Wallet Standard, `solana:mainnet`) | connect, `signMessage`, `signTransaction` | `solana:signIn` |

Amino signing is refused by design: Amino JSON cannot carry the hybrid ML-DSA-87 (FIPS 204) signature. On the EVM lane of QoreChain, a transaction is accepted only when the sender has a registered ML-DSA-87 key and an EVM authorization window opened from the native lane. QoreChain's SVM lane is not open yet. The packages read QoreX's `capabilities` instead of guessing from versions, so new features switch on when QoreX ships them.

## Guides

- [Quickstart: QoreX with wagmi and RainbowKit](docs/quickstart.md)
- [Already support MetaMask? Add QoreX](docs/guides/add-to-metamask-integration.md)
- [Already support Keplr? Add QoreX](docs/guides/add-to-keplr-integration.md)
- [Already support Phantom? Add QoreX](docs/guides/add-to-phantom-integration.md)
- [End-to-end testing with the QoreX mock](docs/guides/e2e-testing.md)
- [Errors and chain ids](docs/guides/errors-and-chain-ids.md)

## Also in this repository

- [`apps/demo`](apps/demo): a demo dApp that exercises every QoreX surface on the `qorechain-diana` testnet, covered by Playwright tests.
- [`examples`](examples): a minimal wagmi + RainbowKit app and a minimal Playwright suite.
- [`registry`](registry): QoreChain entries for ethereum-lists, the Keplr chain registry and the Cosmos chain registry, with validation scripts.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 QoreChain Association.
