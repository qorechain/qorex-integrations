// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const typesSrc = fileURLToPath(new URL("../types/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@qorechain\/qorex-types\/icon$/, replacement: `${typesSrc}icon.ts` },
      { find: /^@qorechain\/qorex-types$/, replacement: `${typesSrc}index.ts` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
