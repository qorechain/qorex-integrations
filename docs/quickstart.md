# Quickstart: QoreX with wagmi and RainbowKit

From an empty directory to a dApp that connects QoreX, in under 10 minutes. You need Node 20.19 or later and a browser with the QoreX extension ([Chrome](https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg), [Firefox](https://addons.mozilla.org/firefox/addon/qorex/), or Safari through the [Mac app](https://apps.apple.com/us/app/qorex-wallet/id6794132220)).

## What works with QoreX on the EVM side today

| Works | Not yet |
|---|---|
| connect (`eth_requestAccounts`), read the account (`eth_accounts`) | `personal_sign`, `eth_signTypedData_v4` |
| read the chain id (`eth_chainId`): 9801 mainnet, 9800 testnet | `eth_sendTransaction` |
| `wallet_switchEthereumChain` to the network already selected in QoreX | `wallet_addEthereumChain`, switching to another network from the dApp |
| | `accountsChanged` / `chainChanged` events |

So today a wagmi dApp can identify the user's EVM address and network with QoreX. Signing and sending fail with "QoreX: EVM method <name> not yet supported". For transactions on QoreChain use the native lane (`window.qorex.native.signAndBroadcast`, see [add-to-keplr-integration.md](guides/add-to-keplr-integration.md)), where QoreX adds the hybrid ML-DSA-87 (FIPS 204) signature.

## 1. Create the app (1 minute)

```bash
npm create vite@latest my-qorechain-dapp -- --template react-ts
cd my-qorechain-dapp
npm install @qorechain/qorex-rainbowkit @rainbow-me/rainbowkit wagmi@2 viem@2 @tanstack/react-query
```

RainbowKit 2 works with wagmi 2, hence `wagmi@2`.

## 2. Configure wagmi with QoreX (2 minutes)

Create `src/wagmi.ts`:

```ts
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { QOREX_CHAINS, qorechain, qorechainTestnet, qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

const connectors = connectorsForWallets(
  // QoreX does not emit accountsChanged / chainChanged yet: re-read on focus.
  [{ groupName: "QoreChain", wallets: [() => qorexWallet({ pollAccountsOnFocus: true })] }],
  // projectId is only used by WalletConnect-based wallets.
  { appName: "My QoreChain dApp", projectId: "YOUR_WALLETCONNECT_PROJECT_ID" },
);

export const config = createConfig({
  chains: QOREX_CHAINS, // QoreChain mainnet (9801) and testnet (9800)
  connectors,
  transports: { [qorechain.id]: http(), [qorechainTestnet.id]: http() },
});
```

Add other RainbowKit wallets to the same list if your dApp supports them.

## 3. Wrap the app (2 minutes)

Replace `src/main.tsx`:

```tsx
import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider, useAccount, useChainId } from "wagmi";
import { config } from "./wagmi";

const queryClient = new QueryClient();

function Account() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  return isConnected ? <p>{address} on chain {chainId}</p> : <p>Not connected</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <ConnectButton />
          <Account />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
```

## 4. Run it (1 minute)

```bash
npm run dev
```

Open the page, click **Connect Wallet**, choose **QoreX** and approve in QoreX. The page shows your `0x` address and chain 9800 or 9801, whichever network is selected in QoreX. Without the extension, RainbowKit offers the store links.

The same app, ready to run, is in [examples/wagmi-rainbowkit](../examples/wagmi-rainbowkit).

## 5. Test it without the extension (3 minutes)

```bash
npm install -D @playwright/test @qorechain/qorex-synpress
npx playwright install chromium
```

`tests/connect.spec.ts`:

```ts
import { expect } from "@playwright/test";
import { qorexMockFixtures } from "@qorechain/qorex-synpress";

const test = qorexMockFixtures({ profile: "current" });

test("connects QoreX", async ({ page, qorex }) => {
  await page.goto("http://localhost:5173");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByRole("button", { name: "QoreX", exact: true }).click();
  await expect(page.getByText(qorex.addresses.evm)).toBeVisible();
});
```

Start `npm run dev` in another terminal and run `npx playwright test`. RainbowKit also lists the mock under "Installed" as **QoreX (mock)**, from its EIP-6963 announcement; either entry connects. More in [guides/e2e-testing.md](guides/e2e-testing.md).

## Good to know

- QoreX never writes `window.ethereum`; it announces itself through EIP-6963 with rdns `network.qore.qorex`. `qorexWallet()` targets exactly that provider.
- The user changes network inside QoreX; the dApp cannot switch it.
- On QoreChain, an EVM transaction is accepted only when the sender has a registered ML-DSA-87 key and an open EVM authorization window, both set up from the native lane.
- Errors and chain ids: [guides/errors-and-chain-ids.md](guides/errors-and-chain-ids.md).
