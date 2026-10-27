// SPDX-License-Identifier: Apache-2.0

import { expect, type Page } from "@playwright/test";

export { expect };

export function out(page: Page, id: string) {
  return page.getByTestId(`out-${id}`);
}

/** Clicks an action and waits until it settles with the expected status. */
export async function run(page: Page, id: string, status: "ok" | "error" = "ok", timeout = 15_000): Promise<void> {
  await page.getByTestId(`btn-${id}`).click();
  await expect(out(page, id)).toHaveAttribute("data-status", /ok|error/, { timeout });
  const actual = await out(page, id).getAttribute("data-status");
  if (actual !== status) throw new Error(`${id}: expected ${status}, got ${actual}: ${await out(page, id).textContent()}`);
}
