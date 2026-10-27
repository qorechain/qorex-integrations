// SPDX-License-Identifier: Apache-2.0

import { testWithSynpress } from "@synthetixio/synpress";
import { describe, expect, it } from "vitest";
import {
  QOREX_EXTENSION_MODE_UNAVAILABLE,
  QorexExtensionModeUnavailableError,
  qorexExtensionFixtures,
  qorexMockFixtures,
} from "../src/index.js";

describe("qorexMockFixtures", () => {
  it("returns a Playwright test that Synpress v4 can merge", () => {
    const test = qorexMockFixtures({ profile: "planned" });
    expect(typeof test.extend).toBe("function");
    expect(typeof test.describe).toBe("function");
    const merged = testWithSynpress(test);
    expect(typeof merged.extend).toBe("function");
  });

  it("refuses options the mock refuses", () => {
    expect(() => qorexMockFixtures({ profile: "nope" as never })).toThrow("unknown profile");
  });
});

describe("qorexExtensionFixtures", () => {
  it("fails with a clear, stable error until QoreX ships test selectors", () => {
    let caught: unknown;
    try {
      qorexExtensionFixtures({ extensionPath: "./qorex-extension" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QorexExtensionModeUnavailableError);
    expect((caught as Error).message).toBe("QoreX extension mode requires stable data-testid selectors in QoreX (planned)");
    expect((caught as Error).message).toBe(QOREX_EXTENSION_MODE_UNAVAILABLE);
    expect((caught as QorexExtensionModeUnavailableError).code).toBe("QOREX_EXTENSION_MODE_UNAVAILABLE");
  });
});
