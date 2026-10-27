// SPDX-License-Identifier: Apache-2.0

import { recoverMessageAddress, recoverTransactionAddress, recoverTypedDataAddress, parseTransaction } from "viem";
import { describe, expect, it } from "vitest";
import { createQorexMock, type QorexMockOptions } from "../src/index.js";
import { chainStub, freshWindow, rejection } from "./helpers.js";

// m/44'/60'/0'/0/0 of the BIP-39 test mnemonic.
const EVM_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

function setup(options: QorexMockOptions = {}) {
  const stub = chainStub({ pqPublicKey: new Uint8Array(2592) });
  const mock = createQorexMock({ fetch: stub.fetch, ...options });
  const win = freshWindow();
  mock.install(win);
  const evm = (win as unknown as { qorex: { evm: { request(a: { method: string; params?: unknown }): Promise<unknown>; on(e: string, l: (...a: unknown[]) => void): void } } }).qorex.evm;
  return { mock, win, evm, stub };
}

const TYPED = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
    ],
    Mail: [
      { name: "from", type: "string" },
      { name: "contents", type: "string" },
    ],
  },
  primaryType: "Mail",
  domain: { name: "QoreX demo", version: "1", chainId: 9800 },
  message: { from: "demo", contents: "hello" },
} as const;

describe.each(["current", "planned"] as const)("EVM, %s profile", (profile) => {
  it("answers eth_chainId, eth_accounts and eth_requestAccounts", async () => {
    const { evm } = setup({ profile });
    expect(await evm.request({ method: "eth_chainId" })).toBe("0x2648");
    expect(await evm.request({ method: "eth_accounts" })).toEqual([]);
    expect(await evm.request({ method: "eth_requestAccounts" })).toEqual([EVM_ADDRESS]);
    expect(await evm.request({ method: "eth_accounts" })).toEqual([EVM_ADDRESS]);
  });

  it("answers 0x2649 on mainnet", async () => {
    const { evm } = setup({ profile, chainId: "qorechain-vladi" });
    expect(await evm.request({ method: "eth_chainId" })).toBe("0x2649");
  });

  it("switches only to the active chain; any other chain is 4902", async () => {
    const { evm } = setup({ profile });
    expect(await evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2648" }] })).toBeNull();
    const err = await rejection(evm.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }));
    expect(err.message).toBe("QoreX: unrecognized chain 0x1");
    expect(err.code).toBe(4902);
  });

  it("refuses the connection when the user rejects", async () => {
    const { evm, mock } = setup({ profile });
    mock.rejectNext();
    const err = await rejection(evm.request({ method: "eth_requestAccounts" }));
    expect(err.message).toBe("QoreX: connection rejected");
    expect(mock.requests.at(-1)).toMatchObject({ method: "evm:eth_requestAccounts", approval: "rejected", outcome: "error" });
  });

  it("waits for approveNext when autoApprove is false", async () => {
    const { evm, mock } = setup({ profile, autoApprove: false });
    const pending = evm.request({ method: "eth_requestAccounts" });
    await Promise.resolve();
    expect(mock.requests[0]?.approval).toBe("pending");
    mock.approveNext();
    expect(await pending).toEqual([EVM_ADDRESS]);
  });
});

describe("EVM, current profile", () => {
  it.each(["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "wallet_addEthereumChain", "eth_sign"])(
    "%s fails with QoreX's message and no code",
    async (method) => {
      const { evm } = setup();
      await evm.request({ method: "eth_requestAccounts" });
      const err = await rejection(evm.request({ method, params: [] }));
      expect(err.message).toBe(`QoreX: EVM method ${method} not yet supported`);
      expect(err.code).toBeUndefined();
    },
  );

  it("never emits accountsChanged or chainChanged", async () => {
    const { evm, mock } = setup({ allowMainnet: true });
    const events: string[] = [];
    evm.on("accountsChanged", () => events.push("accounts"));
    evm.on("chainChanged", () => events.push("chain"));
    await evm.request({ method: "eth_requestAccounts" });
    mock.switchAccount(1);
    mock.switchNetwork("qorechain-vladi");
    expect(events).toEqual([]);
    expect(await evm.request({ method: "eth_chainId" })).toBe("0x2649");
  });
});

describe("EVM, planned profile", () => {
  it("unanswered methods carry code 4200 next to the same text", async () => {
    const { evm } = setup({ profile: "planned" });
    const err = await rejection(evm.request({ method: "eth_sign", params: [] }));
    expect(err.message).toBe("QoreX: EVM method eth_sign not yet supported");
    expect(err.code).toBe(4200);
  });

  it("emits accountsChanged and chainChanged", async () => {
    const { evm, mock } = setup({ profile: "planned", allowMainnet: true });
    const events: unknown[] = [];
    evm.on("accountsChanged", (a) => events.push(["accounts", a]));
    evm.on("chainChanged", (c) => events.push(["chain", c]));
    await evm.request({ method: "eth_requestAccounts" });
    mock.switchAccount(1);
    mock.switchNetwork("qorechain-vladi");
    expect(events[0]).toEqual(["accounts", [EVM_ADDRESS]]);
    expect((events[1] as [string, string[]])[1]).toHaveLength(1);
    expect((events[1] as [string, string[]])[1][0]).not.toBe(EVM_ADDRESS);
    expect(events[2]).toEqual(["chain", "0x2649"]);
  });

  it("personal_sign is an EIP-191 signature by the account", async () => {
    const { evm } = setup({ profile: "planned" });
    const message = "0x" + Buffer.from("Hello QoreX").toString("hex");
    const signature = (await evm.request({ method: "personal_sign", params: [message, EVM_ADDRESS] })) as `0x${string}`;
    expect(await recoverMessageAddress({ message: { raw: message as `0x${string}` }, signature })).toBe(EVM_ADDRESS);
    const plain = (await evm.request({ method: "personal_sign", params: ["plain text", EVM_ADDRESS.toLowerCase()] })) as `0x${string}`;
    expect(await recoverMessageAddress({ message: "plain text", signature: plain })).toBe(EVM_ADDRESS);
  });

  it("personal_sign refuses another signer and a rejection", async () => {
    const { evm, mock } = setup({ profile: "planned" });
    expect((await rejection(evm.request({ method: "personal_sign", params: ["0x00", "0x0000000000000000000000000000000000000001"] }))).message).toBe(
      "QoreX: unknown signer address",
    );
    await evm.request({ method: "eth_requestAccounts" });
    mock.rejectNext();
    expect((await rejection(evm.request({ method: "personal_sign", params: ["0x00", EVM_ADDRESS] }))).message).toBe(
      "QoreX: signature rejected",
    );
  });

  it("eth_signTypedData_v4 signs EIP-712 data", async () => {
    const { evm } = setup({ profile: "planned" });
    const signature = (await evm.request({ method: "eth_signTypedData_v4", params: [EVM_ADDRESS, JSON.stringify(TYPED)] })) as `0x${string}`;
    const { EIP712Domain: _domain, ...types } = TYPED.types;
    void _domain;
    expect(
      await recoverTypedDataAddress({ domain: TYPED.domain, types, primaryType: "Mail", message: TYPED.message, signature }),
    ).toBe(EVM_ADDRESS);
  });

  it("eth_signTypedData_v4 refuses data for another chain", async () => {
    const { evm } = setup({ profile: "planned" });
    const other = { ...TYPED, domain: { ...TYPED.domain, chainId: 1 } };
    const err = await rejection(evm.request({ method: "eth_signTypedData_v4", params: [EVM_ADDRESS, other] }));
    expect(err.message).toMatch(/typed data is for chain 1/);
  });

  it("eth_sendTransaction signs for chain 9800 and sends the raw transaction", async () => {
    const { evm, stub } = setup({ profile: "planned" });
    const hash = await evm.request({
      method: "eth_sendTransaction",
      params: [{ from: EVM_ADDRESS, to: EVM_ADDRESS, value: "0x1" }],
    });
    expect(hash).toBe(`0x${"ab".repeat(32)}`);
    const raw = stub.evmRaw[0] as `0x${string}`;
    const parsed = parseTransaction(raw);
    expect(parsed.chainId).toBe(9800);
    expect(parsed.nonce).toBe(5);
    expect(parsed.value).toBe(1n);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(EVM_ADDRESS);
  });

  it("eth_sendTransaction is refused on mainnet without allowMainnet", async () => {
    const { evm, stub } = setup({ profile: "planned", chainId: "qorechain-vladi" });
    const err = await rejection(evm.request({ method: "eth_sendTransaction", params: [{ from: EVM_ADDRESS, to: EVM_ADDRESS }] }));
    expect(err.message).toMatch(/qorechain-vladi \(mainnet\) is refused/);
    expect(stub.evmRaw).toHaveLength(0);
  });

  it("wallet_addEthereumChain accepts the QoreChain chains and answers 4902 otherwise", async () => {
    const { evm } = setup({ profile: "planned" });
    expect(await evm.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x2648" }] })).toBeNull();
    const err = await rejection(evm.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x89" }] }));
    expect(err.code).toBe(4902);
    expect(err.message).toBe("QoreX: unrecognized chain 0x89");
  });
});
