// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  QOREX_EVM_ERROR_CODES,
  QOREX_MOCK_RDNS,
  QOREX_RDNS,
  isQorexUnrecognizedChainError,
  isQorexUnsupportedMethodError,
} from "../src/index.js";

describe("EVM error helpers", () => {
  it("match today's message text without a code", () => {
    expect(isQorexUnsupportedMethodError(new Error("QoreX: EVM method personal_sign not yet supported"))).toBe(true);
    expect(isQorexUnsupportedMethodError(new Error("QoreX: signature rejected"))).toBe(false);
    expect(isQorexUnrecognizedChainError(new Error("QoreX: unrecognized chain 0x1"))).toBe(true);
  });

  it("match the planned codes first", () => {
    const e4200 = Object.assign(new Error("anything"), { code: QOREX_EVM_ERROR_CODES.unsupportedMethod });
    const e4902 = Object.assign(new Error("anything"), { code: QOREX_EVM_ERROR_CODES.unrecognizedChain });
    expect(isQorexUnsupportedMethodError(e4200)).toBe(true);
    expect(isQorexUnrecognizedChainError(e4902)).toBe(true);
    expect(isQorexUnrecognizedChainError(e4200)).toBe(false);
  });

  it("ignore non-errors", () => {
    expect(isQorexUnsupportedMethodError(undefined)).toBe(false);
    expect(isQorexUnrecognizedChainError("QoreX: unrecognized chain 0x1")).toBe(false);
  });

  it("keeps the mock rdns apart from QoreX", () => {
    expect(QOREX_MOCK_RDNS).not.toBe(QOREX_RDNS);
    expect(QOREX_MOCK_RDNS.startsWith(`${QOREX_RDNS}.`)).toBe(true);
  });
});
