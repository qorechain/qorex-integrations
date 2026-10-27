// SPDX-License-Identifier: Apache-2.0

import { getQorexNative, type QorexEip1193Provider } from "@qorechain/qorex-types";
import { useRef, useState } from "react";
import { base58, encodeMsgSend, toHex } from "./proto";
import { CHAIN_ID, REST, discoverEip6963, pickQorex, qorexSolanaWallet, readLayer } from "./wallets";

type Outcome = { status: "idle" | "busy" | "ok" | "error"; text: string };

function describeError(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown };
  const out: Record<string, unknown> = { message: typeof e?.message === "string" ? e.message : String(err) };
  if (typeof e?.code === "number" || typeof e?.code === "string") out.code = e.code;
  return JSON.stringify(out, null, 2);
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function Action(props: { id: string; label: string; run: () => Promise<unknown>; disabled?: boolean }) {
  const [out, setOut] = useState<Outcome>({ status: "idle", text: "" });
  const go = async () => {
    setOut({ status: "busy", text: "waiting for the wallet" });
    try {
      setOut({ status: "ok", text: show(await props.run()) });
    } catch (err) {
      setOut({ status: "error", text: describeError(err) });
    }
  };
  return (
    <div className="action">
      <button data-testid={`btn-${props.id}`} onClick={go} disabled={props.disabled || out.status === "busy"}>
        {props.label}
      </button>
      <pre data-testid={`out-${props.id}`} data-status={out.status} className={`out ${out.status}`}>
        {out.text}
      </pre>
    </div>
  );
}

const DEMO_MESSAGE = "Hello from the QoreX demo dApp";

export function App() {
  const evm = useRef<QorexEip1193Provider | undefined>(undefined);
  const [evmAccount, setEvmAccount] = useState<string>("");
  const [events, setEvents] = useState<string[]>([]);
  const [qorAddress, setQorAddress] = useState<string>("");
  const [solWallet, setSolWallet] = useState<ReturnType<typeof qorexSolanaWallet>>(undefined);
  const [solAccount, setSolAccount] = useState<{ address: string; publicKey: Uint8Array } | undefined>(undefined);

  function onAccounts(...args: unknown[]) {
    setEvents((e) => [...e, `accountsChanged ${JSON.stringify(args[0])}`]);
    const list = args[0] as string[] | undefined;
    if (list?.[0]) setEvmAccount(list[0]);
  }
  function onChain(...args: unknown[]) {
    setEvents((e) => [...e, `chainChanged ${String(args[0])}`]);
  }

  const provider = (): QorexEip1193Provider => {
    if (!evm.current) throw new Error("Discover the wallet first");
    return evm.current;
  };
  const native = () => {
    const n = getQorexNative();
    if (!n) throw new Error("QoreX native provider not found");
    return n;
  };

  return (
    <main>
      <header>
        <h1>QoreX demo dApp</h1>
        <p>
          Network <code>{CHAIN_ID}</code> (EVM chain id 9800). REST <code>{REST}</code>.
        </p>
      </header>

      <section>
        <h2>EVM</h2>
        <Action
          id="evm-discover"
          label="Discover (EIP-6963)"
          run={async () => {
            const list = await discoverEip6963();
            const q = pickQorex(list);
            if (!q) throw new Error(`QoreX not announced; saw ${list.map((d) => d.info.rdns).join(", ") || "nothing"}`);
            evm.current = q.provider;
            q.provider.on("accountsChanged", onAccounts);
            q.provider.on("chainChanged", onChain);
            return `${q.info.name} (${q.info.rdns})`;
          }}
        />
        <Action
          id="evm-connect"
          label="Connect (eth_requestAccounts)"
          run={async () => {
            const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
            setEvmAccount(accounts[0] ?? "");
            return accounts;
          }}
        />
        <Action id="evm-chain-id" label="eth_chainId" run={() => provider().request({ method: "eth_chainId" })} />
        <Action
          id="evm-switch"
          label="Switch to QoreChain testnet (0x2648)"
          run={async () => (await provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2648" }] })) ?? "null"}
        />
        <Action
          id="evm-switch-other"
          label="Switch to Ethereum (0x1)"
          run={async () => (await provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] })) ?? "null"}
        />
        <Action
          id="evm-personal-sign"
          label="personal_sign"
          run={() =>
            provider().request({
              method: "personal_sign",
              params: [toHex(new TextEncoder().encode(DEMO_MESSAGE)), evmAccount],
            })
          }
        />
        <Action
          id="evm-typed-data"
          label="eth_signTypedData_v4"
          run={() =>
            provider().request({
              method: "eth_signTypedData_v4",
              params: [
                evmAccount,
                JSON.stringify({
                  types: {
                    EIP712Domain: [
                      { name: "name", type: "string" },
                      { name: "version", type: "string" },
                      { name: "chainId", type: "uint256" },
                    ],
                    Greeting: [
                      { name: "from", type: "address" },
                      { name: "contents", type: "string" },
                    ],
                  },
                  primaryType: "Greeting",
                  domain: { name: "QoreX demo", version: "1", chainId: 9800 },
                  message: { from: evmAccount, contents: DEMO_MESSAGE },
                }),
              ],
            })
          }
        />
        <h3>Events from the wallet</h3>
        <pre data-testid="out-evm-events" className="out">
          {events.length ? events.join("\n") : "none received"}
        </pre>
      </section>

      <section>
        <h2>QoreChain (Cosmos SDK lane)</h2>
        <Action
          id="cosmos-get-key"
          label="getKey"
          run={async () => {
            const key = await native().getKey(CHAIN_ID);
            setQorAddress(key.bech32Address);
            return { bech32Address: key.bech32Address, algo: key.algo, pubKey: toHex(Uint8Array.from(key.pubKey)) };
          }}
        />
        <SendAction address={qorAddress} native={native} />
        <Action
          id="cosmos-sign-arbitrary"
          label="signArbitrary"
          disabled={!qorAddress}
          run={() => native().signArbitrary(CHAIN_ID, qorAddress, DEMO_MESSAGE)}
        />
      </section>

      <section>
        <h2>Solana (Wallet Standard)</h2>
        <Action
          id="sol-connect"
          label="Connect"
          run={async () => {
            const w = qorexSolanaWallet();
            if (!w) throw new Error("No QoreX Wallet Standard wallet registered");
            setSolWallet(w);
            const feature = w.features["standard:connect"] as { connect(): Promise<{ accounts: Array<{ address: string; publicKey: Uint8Array }> }> };
            const { accounts } = await feature.connect();
            setSolAccount(accounts[0]);
            return { wallet: w.name, address: accounts[0]?.address };
          }}
        />
        <Action
          id="sol-sign-message"
          label="signMessage"
          disabled={!solAccount}
          run={async () => {
            const feature = solWallet!.features["solana:signMessage"] as {
              signMessage(...i: Array<{ account: unknown; message: Uint8Array }>): Promise<Array<{ signature: Uint8Array }>>;
            };
            const [out] = await feature.signMessage({ account: solAccount, message: new TextEncoder().encode(DEMO_MESSAGE) });
            return { signature: base58(out!.signature) };
          }}
        />
      </section>
    </main>
  );
}

function SendAction(props: { address: string; native: () => ReturnType<typeof getQorexNative> & object }) {
  const [layer, setLayer] = useState<Outcome>({ status: "idle", text: "" });
  return (
    <>
      <Action
        id="cosmos-send"
        label="signAndBroadcast: send 1 uqor to myself"
        disabled={!props.address}
        run={async () => {
          setLayer({ status: "idle", text: "" });
          const res = await props.native().signAndBroadcast({
            chainId: CHAIN_ID,
            messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: encodeMsgSend(props.address, props.address, "1") }],
            memo: "QoreX demo",
          });
          setLayer({ status: "busy", text: "reading the transaction back" });
          readLayer(res.txHash).then(
            (text) => setLayer({ status: text.startsWith("hybrid") ? "ok" : "error", text }),
            (err) => setLayer({ status: "error", text: describeError(err) }),
          );
          return res;
        }}
      />
      <pre data-testid="out-cosmos-layer" data-status={layer.status} className={`out ${layer.status}`}>
        {layer.text}
      </pre>
    </>
  );
}
