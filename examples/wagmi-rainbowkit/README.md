# Example: wagmi and RainbowKit with QoreX

A minimal Vite app with RainbowKit, wagmi and `qorexWallet()` on the QoreChain EVM chains (9801 mainnet, 9800 testnet).

```bash
pnpm install
pnpm dev
```

What works with QoreX on the EVM side today: connecting (`eth_requestAccounts`), reading the account and the chain id, and switching to the network already selected in QoreX. Signing (`personal_sign`, typed data) and sending transactions are not supported by QoreX yet; the "Sign a message" button shows the wallet's answer: "QoreX: EVM method personal_sign not yet supported". QoreX does not emit `accountsChanged` or `chainChanged` yet, so the wallet is created with `pollAccountsOnFocus: true`.

Full walkthrough: [docs/quickstart.md](../../docs/quickstart.md).
