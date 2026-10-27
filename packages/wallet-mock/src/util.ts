// SPDX-License-Identifier: Apache-2.0
//
// Small helpers shared by the providers.

import { fromBase64 } from "@qorechain/qoresign";

/** Error shaped like the ones QoreX rebuilds in the page: a message, and a numeric `code` only when given. */
export function walletError(message: string, code?: number): Error {
  const err = new Error(message);
  if (code !== undefined) (err as Error & { code: number }).code = code;
  return err;
}

/** Bytes in any form a page may send: `Uint8Array`, `number[]`, base64 string or an index-keyed object. */
export function bytesFrom(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === "string") return fromBase64(value);
  if (value && typeof value === "object") return Uint8Array.from(Object.values(value as Record<string, number>));
  return new Uint8Array();
}

/** Copy of `value` that survives JSON and `page.evaluate`: bytes become `number[]`, bigint becomes a string. */
export function jsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[...]";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v, depth + 1);
    return out;
  }
  if (typeof value === "function") return undefined;
  return value;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
