// SPDX-License-Identifier: Apache-2.0
// The part of jsdom the tests use.

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; runScripts?: "dangerously" | "outside-only" });
    readonly window: Window & { eval(script: string): unknown };
  }
}
