// SPDX-License-Identifier: Apache-2.0
//
// @qorechain/qorex-synpress: Playwright fixtures for dApps that use QoreX,
// in the Synpress v4 style (`testWithSynpress(qorexMockFixtures(...))` or
// directly as a Playwright `test`).

import { test as base, type Page } from "@playwright/test";
import {
  createQorexMock,
  type QorexMock,
  type QorexMockAddresses,
  type QorexMockChainId,
  type QorexMockOptions,
  type QorexMockRequest,
} from "@qorechain/qorex-wallet-mock";

/** Options of the mock fixture: every `createQorexMock` option except `fetch` (the page's own `fetch` is used). */
export type QorexMockFixtureOptions = Omit<QorexMockOptions, "fetch">;

/** The `qorex` fixture. Every method acts on the mock in the current page. */
export interface QorexFixture {
  /** The mock as configured (options, locally derived addresses, `initScript()`). */
  readonly mock: QorexMock;
  /** Addresses of the configured account. */
  readonly addresses: QorexMockAddresses;
  /** Grants the next approval, or the one waiting now. */
  approveNext(): Promise<void>;
  /** Refuses the next approval, or the one waiting now. */
  rejectNext(): Promise<void>;
  /** Every call the page made to the mock since the page loaded. */
  requests(): Promise<QorexMockRequest[]>;
  clearRequests(): Promise<void>;
  /** Approvals waiting for an answer (with `autoApprove: false`). */
  pendingApprovals(): Promise<number>;
  /** Resolves when at least one approval is waiting (with `autoApprove: false`). */
  waitForApproval(options?: { timeout?: number }): Promise<void>;
  /** Selects another account; emits `accountsChanged` in the planned profile. */
  switchAccount(index: number): Promise<void>;
  /** Selects the other QoreChain network; emits `chainChanged` in the planned profile. */
  switchNetwork(chainId: QorexMockChainId): Promise<void>;
  /** Forgets the site connection. */
  disconnect(): Promise<void>;
}

export interface QorexMockFixtures {
  qorex: QorexFixture;
}

const NOT_INSTALLED = "QoreX (mock) is not installed in this page yet; navigate with page.goto first.";

function pageFixture(page: Page, mock: QorexMock): QorexFixture {
  const call = async <T>(fn: (arg: unknown) => T, arg?: unknown): Promise<T> => {
    await page.waitForFunction(() => window.__qorexMock !== undefined, undefined, { timeout: 5_000 }).catch(() => {
      throw new Error(NOT_INSTALLED);
    });
    return page.evaluate(fn as (arg: unknown) => T, arg) as Promise<T>;
  };
  return {
    mock,
    addresses: mock.addresses(),
    approveNext: () => call(() => window.__qorexMock!.approveNext()),
    rejectNext: () => call(() => window.__qorexMock!.rejectNext()),
    requests: () => call(() => JSON.parse(JSON.stringify(window.__qorexMock!.requests)) as QorexMockRequest[]),
    clearRequests: () => call(() => window.__qorexMock!.clearRequests()),
    pendingApprovals: () => call(() => window.__qorexMock!.pendingApprovals),
    waitForApproval: async (options = {}) => {
      await page.waitForFunction(() => (window.__qorexMock?.pendingApprovals ?? 0) > 0, undefined, {
        timeout: options.timeout ?? 10_000,
      });
    },
    switchAccount: (index) => call((i) => window.__qorexMock!.switchAccount(i as number), index),
    switchNetwork: (chainId) => call((c) => window.__qorexMock!.switchNetwork(c as QorexMockChainId), chainId),
    disconnect: () => call(() => window.__qorexMock!.disconnect()),
  };
}

/**
 * Playwright `test` with a `qorex` fixture. The fixture is automatic: it
 * adds the mock's init script to `page` before the test navigates, so every
 * page the test opens has `window.qorex` and the EIP-6963 announcement.
 *
 * ```ts
 * import { testWithSynpress } from "@synthetixio/synpress";
 * import { qorexMockFixtures } from "@qorechain/qorex-synpress";
 *
 * const test = testWithSynpress(qorexMockFixtures({ profile: "current" }));
 * test("connects", async ({ page, qorex }) => { ... });
 * ```
 */
export function qorexMockFixtures(options: QorexMockFixtureOptions = {}) {
  const mock = createQorexMock(options);
  let script: string | undefined;
  return base.extend<QorexMockFixtures>({
    qorex: [
      async ({ page }, use) => {
        script ??= mock.initScript();
        await page.addInitScript({ content: script });
        await use(pageFixture(page, mock));
      },
      { auto: true },
    ],
  });
}

/** Message of the error `qorexExtensionFixtures` throws. */
export const QOREX_EXTENSION_MODE_UNAVAILABLE =
  "QoreX extension mode requires stable data-testid selectors in QoreX (planned)";

/** Thrown by `qorexExtensionFixtures` until QoreX ships stable test selectors. */
export class QorexExtensionModeUnavailableError extends Error {
  readonly code = "QOREX_EXTENSION_MODE_UNAVAILABLE";
  constructor() {
    super(QOREX_EXTENSION_MODE_UNAVAILABLE);
    this.name = "QorexExtensionModeUnavailableError";
  }
}

export interface QorexExtensionFixturesOptions {
  /** Path to the unpacked QoreX extension. */
  readonly extensionPath: string;
  /** Wallet password used to unlock the extension. */
  readonly password?: string;
}

/** The fixture extension mode will provide. */
export interface QorexExtensionFixture {
  /** The extension id Chromium assigned. */
  readonly extensionId: string;
  unlock(password?: string): Promise<void>;
  approve(): Promise<void>;
  reject(): Promise<void>;
}

/**
 * Extension mode: drives the real QoreX extension in Chromium. This is the
 * planned interface only. It needs stable `data-testid` selectors in the
 * QoreX approval windows, which QoreX has not shipped yet, so today it throws
 * `QorexExtensionModeUnavailableError`. Use `qorexMockFixtures`.
 */
export function qorexExtensionFixtures(options: QorexExtensionFixturesOptions): ReturnType<
  typeof base.extend<{ qorexExtension: QorexExtensionFixture }>
> {
  void options;
  throw new QorexExtensionModeUnavailableError();
}

export type { QorexMock, QorexMockAddresses, QorexMockChainId, QorexMockRequest } from "@qorechain/qorex-wallet-mock";
