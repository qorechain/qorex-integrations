// SPDX-License-Identifier: Apache-2.0
//
// State shared by the three providers of one mock wallet: the selected
// account and network, the site connection, approvals and the request log.

import type { FetchLike } from "@qorechain/qoresign/network";
import { MockAccount } from "./keys.js";
import type { QorexMockChainId, ResolvedOptions } from "./options.js";
import { jsonSafe, walletError } from "./util.js";

/** One call a page made to the mock. */
export interface QorexMockRequest {
  readonly id: number;
  /** `evm:<method>`, `native:<method>` or `svm:<method>`. */
  readonly method: string;
  /** Parameters as JSON (bytes as `number[]`). */
  readonly params: unknown;
  /** Whether an approval was asked and how it was answered. */
  approval: "none" | "pending" | "approved" | "rejected";
  outcome: "pending" | "ok" | "error";
  /** Result as JSON, when `outcome` is `ok`. */
  result?: unknown;
  /** Error message, when `outcome` is `error`. */
  error?: string;
  /** Error code, when the error has one. */
  errorCode?: number;
}

type Listener = (...args: unknown[]) => void;

export class MockController {
  readonly options: ResolvedOptions;
  readonly fetch: FetchLike;
  chainId: QorexMockChainId;
  connected = false;
  private accountIndex: number;
  private readonly accounts = new Map<number, MockAccount>();
  private readonly decisions: boolean[] = [];
  private readonly waiting: Array<(ok: boolean) => void> = [];
  private nextId = 1;
  readonly log: QorexMockRequest[] = [];
  readonly evmListeners = new Map<string, Set<Listener>>();

  constructor(options: ResolvedOptions, fetchImpl?: FetchLike) {
    this.options = options;
    this.chainId = options.chainId;
    this.accountIndex = options.accountIndex;
    this.fetch = fetchImpl ?? ((url, init) => globalThis.fetch(url, init) as ReturnType<FetchLike>);
  }

  get planned(): boolean {
    return this.options.profile === "planned";
  }

  get account(): MockAccount {
    return this.accountAt(this.accountIndex);
  }

  get activeIndex(): number {
    return this.accountIndex;
  }

  accountAt(index: number): MockAccount {
    let a = this.accounts.get(index);
    if (!a) {
      a = new MockAccount(this.options.mnemonic, index);
      this.accounts.set(index, a);
    }
    return a;
  }

  /** Accounts the wallet lists: every index from 0 to the highest one used. */
  knownIndexes(): number[] {
    const max = Math.max(this.options.accountIndex, this.accountIndex, ...this.accounts.keys());
    return Array.from({ length: max + 1 }, (_, i) => i);
  }

  get evmChainIdHex(): "0x2649" | "0x2648" {
    return this.chainId === "qorechain-vladi" ? "0x2649" : "0x2648";
  }

  get rest(): string {
    return this.options.rest;
  }

  /** Refuses mainnet unless `allowMainnet`. */
  assertNetworkAllowed(chainId: string): void {
    if (chainId === "qorechain-vladi" && !this.options.allowMainnet) {
      throw walletError(
        "QoreX (mock): qorechain-vladi (mainnet) is refused. Pass allowMainnet: true to createQorexMock to sign for mainnet.",
      );
    }
  }

  // Request log ----------------------------------------------------------------

  begin(method: string, params: unknown): QorexMockRequest {
    const entry: QorexMockRequest = {
      id: this.nextId++,
      method,
      params: jsonSafe(params),
      approval: "none",
      outcome: "pending",
    };
    this.log.push(entry);
    return entry;
  }

  async run<T>(method: string, params: unknown, body: (entry: QorexMockRequest) => Promise<T> | T): Promise<T> {
    const entry = this.begin(method, params);
    try {
      const result = await body(entry);
      entry.outcome = "ok";
      entry.result = jsonSafe(result);
      return result;
    } catch (err) {
      entry.outcome = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: unknown } | null)?.code;
      if (typeof code === "number") entry.errorCode = code;
      throw err;
    }
  }

  // Approvals ------------------------------------------------------------------

  /** Asks for an approval; resolves true when granted. */
  approval(entry: QorexMockRequest): Promise<boolean> {
    entry.approval = "pending";
    const settle = (ok: boolean): boolean => {
      entry.approval = ok ? "approved" : "rejected";
      return ok;
    };
    if (this.decisions.length > 0) return Promise.resolve(settle(this.decisions.shift()!));
    if (this.options.autoApprove) return Promise.resolve(settle(true));
    return new Promise((resolve) => this.waiting.push((ok) => resolve(settle(ok))));
  }

  approveNext(): void {
    const w = this.waiting.shift();
    if (w) w(true);
    else this.decisions.push(true);
  }

  rejectNext(): void {
    const w = this.waiting.shift();
    if (w) w(false);
    else this.decisions.push(false);
  }

  get pendingApprovals(): number {
    return this.waiting.length;
  }

  async ensureConnected(entry: QorexMockRequest): Promise<void> {
    if (this.connected) return;
    if (!(await this.approval(entry))) throw walletError("QoreX: connection rejected");
    this.connected = true;
    if (this.planned) this.emitEvm("accountsChanged", [this.account.evm.address]);
  }

  // Events (planned profile only) ------------------------------------------------

  emitEvm(event: string, ...args: unknown[]): void {
    if (!this.planned) return;
    for (const l of [...(this.evmListeners.get(event) ?? [])]) {
      try {
        l(...args);
      } catch {
        /* a listener that throws must not break the wallet */
      }
    }
  }

  switchAccount(index: number): void {
    if (!Number.isInteger(index) || index < 0) throw new Error("QoreX (mock): invalid account index");
    if (index === this.accountIndex) return;
    this.accountIndex = index;
    if (this.connected) this.emitEvm("accountsChanged", [this.account.evm.address]);
  }

  switchNetwork(chainId: QorexMockChainId): void {
    if (chainId !== "qorechain-diana" && chainId !== "qorechain-vladi") {
      throw new Error(`QoreX (mock): unsupported chain ${String(chainId)}`);
    }
    this.assertNetworkAllowed(chainId);
    if (chainId === this.chainId) return;
    this.chainId = chainId;
    this.emitEvm("chainChanged", this.evmChainIdHex);
  }
}
