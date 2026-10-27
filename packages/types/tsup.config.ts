// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", icon: "src/icon.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "es2022",
  splitting: true,
});
