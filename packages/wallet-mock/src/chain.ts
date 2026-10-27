// SPDX-License-Identifier: Apache-2.0
//
// REST reads the native lane needs beyond what QoreSign provides.

import type { FetchLike } from "@qorechain/qoresign/network";
import { sleep, walletError } from "./util.js";

interface Rest {
  rest: string;
  fetch: FetchLike;
}

async function getJson(opts: Rest, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let res;
  try {
    res = await opts.fetch(`${opts.rest}${path}`);
  } catch (err) {
    throw walletError(`QoreX: the network could not be reached (${String(err)})`);
  }
  const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { status: res.status, body };
}

export async function fetchAccountInfo(
  opts: Rest & { address: string; chainId: string },
): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const { status, body } = await getJson(opts, `/cosmos/auth/v1beta1/account_info/${encodeURIComponent(opts.address)}`);
  const info = body.info as { account_number?: string; sequence?: string } | undefined;
  if (!info) {
    if (status === 404 || status === 400 || status === 500) {
      throw walletError(`QoreX: account ${opts.address} does not exist on ${opts.chainId} yet. Fund it first.`);
    }
    throw walletError(`QoreX: could not read account ${opts.address} (HTTP ${status})`);
  }
  return { accountNumber: BigInt(info.account_number ?? "0"), sequence: BigInt(info.sequence ?? "0") };
}

export interface CommittedTx {
  code: number;
  height: number;
  extensionTypeUrls: string[];
}

export async function fetchCommittedTx(opts: Rest & { txhash: string }): Promise<CommittedTx | undefined> {
  const { status, body } = await getJson(opts, `/cosmos/tx/v1beta1/txs/${encodeURIComponent(opts.txhash)}`);
  if (status === 404 || status >= 400) return undefined;
  const tr = body.tx_response as { code?: number; height?: string } | undefined;
  if (!tr) return undefined;
  const ext = ((body.tx as { body?: { extension_options?: unknown } } | undefined)?.body?.extension_options ?? []) as Array<
    Record<string, unknown>
  >;
  return {
    code: Number(tr.code ?? 0),
    height: Number(tr.height ?? 0),
    extensionTypeUrls: Array.isArray(ext) ? ext.map((e) => String(e["@type"] ?? e.type_url ?? "")) : [],
  };
}

export async function waitForTx(
  opts: Rest & { txhash: string; timeoutMs: number; pollMs: number },
): Promise<CommittedTx | undefined> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const tx = await fetchCommittedTx(opts);
    if (tx) return tx;
    if (Date.now() + opts.pollMs > deadline) return undefined;
    await sleep(opts.pollMs);
  }
}
