// SPDX-License-Identifier: Apache-2.0

import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider, useAccount, useChainId, useSignMessage } from "wagmi";
import { config } from "./wagmi";

const queryClient = new QueryClient();

function Status() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [result, setResult] = useState("");
  if (!isConnected) return <p>Not connected.</p>;
  return (
    <div>
      <p>
        Account <code>{address}</code> on chain <code>{chainId}</code>
      </p>
      <button
        onClick={() =>
          signMessageAsync({ message: "Hello from QoreChain" }).then(
            (sig) => setResult(sig),
            (err: Error) => setResult(err.message),
          )
        }
      >
        Sign a message
      </button>
      <pre>{result}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
            <h1>QoreX with wagmi and RainbowKit</h1>
            <ConnectButton />
            <Status />
          </main>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
