// SPDX-License-Identifier: Apache-2.0
//
// Entry of the page script built as an IIFE (global `QorexWalletMock`).
// `createQorexMock().initScript()` appends a call to `installFromConfig`.

import { MockController } from "./controller.js";
import { installInto, type QorexMockControl } from "./install.js";
import { resolveOptions, type QorexMockOptions } from "./options.js";

export function installFromConfig(win: Window, options: Omit<QorexMockOptions, "fetch">): QorexMockControl | undefined {
  if (win.__qorexMock) return win.__qorexMock;
  const ctl = new MockController(resolveOptions(options), (url, init) => win.fetch(url, init));
  return installInto(win, ctl);
}
