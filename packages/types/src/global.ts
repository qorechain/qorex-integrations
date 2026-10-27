// SPDX-License-Identifier: Apache-2.0

import type { QorexInjected } from "./providers.js";

declare global {
  interface Window {
    /** Injected by QoreX: `{ evm, native, svm }`. Absent when QoreX is not installed. */
    qorex?: QorexInjected;
  }
}

export {};
