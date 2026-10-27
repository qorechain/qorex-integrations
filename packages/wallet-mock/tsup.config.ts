// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: false,
    target: "es2022",
    shims: true,
  },
  {
    // Self-contained page script for Playwright `addInitScript`: carries
    // QoreSign, viem and every other dependency.
    entry: { inpage: "src/inpage.ts" },
    format: ["iife"],
    globalName: "QorexWalletMock",
    platform: "browser",
    noExternal: [/.*/],
    minify: true,
    sourcemap: false,
    clean: false,
    target: "es2020",
    dts: false,
  },
]);
