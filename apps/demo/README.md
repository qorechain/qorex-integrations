# QoreX demo dApp

Private Vite + React app that exercises every QoreX path on `qorechain-diana`. Each action shows the wallet's answer, success or error.

```bash
pnpm --filter @qorechain/qorex-demo dev
```

| Lane | Actions |
|---|---|
| EVM | EIP-6963 discovery, `eth_requestAccounts`, `eth_chainId`, `wallet_switchEthereumChain` (0x2648 and 0x1), `personal_sign`, `eth_signTypedData_v4`, received events |
| QoreChain | `getKey`, `signAndBroadcast` of a 1 uqor self-send with the hybrid layer read back from REST, `signArbitrary` |
| Solana | Wallet Standard connect and `signMessage` |

`VITE_QORE_REST` overrides the REST endpoint (default `https://api-testnet.qore.host`).

## End-to-end tests

```bash
pnpm exec playwright install chromium
pnpm --filter @qorechain/qorex-demo test:e2e
```

`e2e/current.spec.ts` and `e2e/planned.spec.ts` run against `vite preview` with the QoreX mock in each profile. The REST endpoint is stubbed with Playwright routing; the stub keeps every broadcast transaction and the tests verify its hybrid signature with QoreSign.

`e2e/live.spec.ts` broadcasts for real on `qorechain-diana`, with no stub. It runs only with `QORE_LIVE_TEST=1` and `QORE_TEST_MNEMONIC` set to a funded testnet account:

```bash
QORE_LIVE_TEST=1 QORE_TEST_MNEMONIC="..." pnpm --filter @qorechain/qorex-demo test:e2e live
```
