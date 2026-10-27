// SPDX-License-Identifier: Apache-2.0
//
// EIP-1193 provider (`window.qorex.evm`).
//
// current: eth_chainId, eth_accounts, eth_requestAccounts and
// wallet_switchEthereumChain (active chain only, 4902 otherwise); every other
// method fails with "QoreX: EVM method <name> not yet supported" and no code;
// no events.
//
// planned: adds accountsChanged / chainChanged, code 4200 on unanswered
// methods and 4902 on unknown chains (same message text), personal_sign,
// eth_signTypedData_v4, eth_sendTransaction and wallet_addEthereumChain.
// eth_sendTransaction is signed here and sent to the EVM JSON-RPC endpoint;
// the mock does not open the EVM authorization window QoreChain requires, so
// the node's answer is returned as is.

import type { QorexEip1193Provider } from "@qorechain/qorex-types";
import { privateKeyToAccount } from "viem/accounts";
import type { MockController, QorexMockRequest } from "./controller.js";
import { hexToBytes, walletError } from "./util.js";

const CODE_UNSUPPORTED = 4200;
const CODE_UNRECOGNIZED_CHAIN = 4902;
const KNOWN_EVM_CHAINS = new Set(["0x2648", "0x2649"]);

interface RequestArgs {
  method: string;
  params?: unknown;
}

function paramList(args: RequestArgs): unknown[] {
  return Array.isArray(args.params) ? args.params : [];
}

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

type Hex = `0x${string}`;

function quantity(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return BigInt(v as string | number | bigint);
}

async function rpc(ctl: MockController, method: string, params: unknown[]): Promise<unknown> {
  let res;
  try {
    res = await ctl.fetch(ctl.options.evmRpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (err) {
    throw walletError(`QoreX: the EVM endpoint could not be reached (${String(err)})`);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code?: number; message?: string } };
  if (body.error) throw walletError(`QoreX: ${body.error.message ?? "EVM request failed"}`, body.error.code);
  return body.result;
}

export function createEvmProvider(ctl: MockController): QorexEip1193Provider {
  const unsupported = (method: string): Error =>
    walletError(`QoreX: EVM method ${method} not yet supported`, ctl.planned ? CODE_UNSUPPORTED : undefined);
  const unrecognized = (chain: string): Error => walletError(`QoreX: unrecognized chain ${chain}`, CODE_UNRECOGNIZED_CHAIN);

  async function sign(entry: QorexMockRequest): Promise<void> {
    await ctl.ensureConnected(entry);
    if (!(await ctl.approval(entry))) throw walletError("QoreX: signature rejected");
  }

  function requireSigner(address: unknown): void {
    if (!sameAddress(address, ctl.account.evm.address)) throw walletError("QoreX: unknown signer address");
  }

  async function handle(args: RequestArgs, entry: QorexMockRequest): Promise<unknown> {
    const params = paramList(args);
    switch (args.method) {
      case "eth_chainId":
        return ctl.evmChainIdHex;
      case "eth_accounts":
        return ctl.connected ? [ctl.account.evm.address] : [];
      case "eth_requestAccounts":
        await ctl.ensureConnected(entry);
        return [ctl.account.evm.address];
      case "wallet_switchEthereumChain": {
        const target = (params[0] as { chainId?: string } | undefined)?.chainId;
        if (!target || target.toLowerCase() === ctl.evmChainIdHex) return null;
        throw unrecognized(target);
      }
    }
    if (!ctl.planned) throw unsupported(args.method);

    switch (args.method) {
      case "wallet_addEthereumChain": {
        const target = String((params[0] as { chainId?: string } | undefined)?.chainId ?? "");
        if (KNOWN_EVM_CHAINS.has(target.toLowerCase())) return null;
        throw unrecognized(target || "(none)");
      }
      case "personal_sign": {
        const [message, address] = params;
        requireSigner(address);
        if (typeof message !== "string") throw walletError("QoreX: personal_sign needs a message");
        await sign(entry);
        const account = privateKeyToAccount(ctl.account.evm.privateKey);
        const raw = /^0x([0-9a-fA-F]{2})*$/.test(message) ? hexToBytes(message) : new TextEncoder().encode(message);
        return account.signMessage({ message: { raw } });
      }
      case "eth_signTypedData_v4": {
        const [address, data] = params;
        requireSigner(address);
        let typed: Record<string, unknown>;
        try {
          typed = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown>;
        } catch {
          throw walletError("QoreX: typed data is not valid JSON");
        }
        if (!typed || typeof typed !== "object") throw walletError("QoreX: typed data is missing");
        const domain = (typed.domain ?? {}) as { chainId?: unknown };
        if (domain.chainId !== undefined && BigInt(domain.chainId as string | number) !== BigInt(ctl.evmChainIdHex)) {
          throw walletError(`QoreX: typed data is for chain ${String(domain.chainId)}, not the active network`);
        }
        await sign(entry);
        const types = { ...(typed.types as Record<string, unknown>) };
        delete types.EIP712Domain;
        const account = privateKeyToAccount(ctl.account.evm.privateKey);
        const typedArgs = {
          domain: typed.domain,
          types,
          primaryType: typed.primaryType,
          message: typed.message,
        } as unknown as Parameters<typeof account.signTypedData>[0];
        return account.signTypedData(typedArgs);
      }
      case "eth_sendTransaction": {
        const tx = (params[0] ?? {}) as Record<string, unknown>;
        requireSigner(tx.from);
        ctl.assertNetworkAllowed(ctl.chainId);
        await sign(entry);
        const from = ctl.account.evm.address;
        const chainId = Number(BigInt(ctl.evmChainIdHex));
        const nonce = quantity(tx.nonce) ?? BigInt((await rpc(ctl, "eth_getTransactionCount", [from, "pending"])) as string);
        const call = { from, to: tx.to, value: tx.value, data: tx.data ?? tx.input };
        const gas = quantity(tx.gas) ?? (BigInt((await rpc(ctl, "eth_estimateGas", [call])) as string) * 12n) / 10n;
        const account = privateKeyToAccount(ctl.account.evm.privateKey);
        const base = {
          chainId,
          nonce: Number(nonce),
          gas,
          to: (tx.to as Hex | undefined) ?? null,
          value: quantity(tx.value) ?? 0n,
          data: (tx.data ?? tx.input) as Hex | undefined,
        };
        const maxFeePerGas = quantity(tx.maxFeePerGas);
        const signed =
          maxFeePerGas !== undefined
            ? await account.signTransaction({
                ...base,
                type: "eip1559",
                maxFeePerGas,
                maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas) ?? 0n,
              })
            : await account.signTransaction({
                ...base,
                type: "legacy",
                gasPrice: quantity(tx.gasPrice) ?? BigInt((await rpc(ctl, "eth_gasPrice", [])) as string),
              });
        return rpc(ctl, "eth_sendRawTransaction", [signed]);
      }
      default:
        throw unsupported(args.method);
    }
  }

  return {
    isQoreX: true,
    request: (args) => {
      const a = args as RequestArgs;
      if (!a || typeof a.method !== "string") return Promise.reject(walletError("QoreX: invalid request"));
      return ctl.run(`evm:${a.method}`, a.params ?? [], (entry) => handle(a, entry));
    },
    on: (event, listener) => {
      let set = ctl.evmListeners.get(event);
      if (!set) ctl.evmListeners.set(event, (set = new Set()));
      set.add(listener);
    },
    removeListener: (event, listener) => {
      ctl.evmListeners.get(event)?.delete(listener);
    },
  };
}
