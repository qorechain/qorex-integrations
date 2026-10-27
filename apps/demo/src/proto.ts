// SPDX-License-Identifier: Apache-2.0
//
// Just enough protobuf to encode cosmos.bank.v1beta1.MsgSend.

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function field(no: number, payload: Uint8Array): number[] {
  return [...varint((no << 3) | 2), ...varint(payload.length), ...payload];
}

const text = (s: string) => new TextEncoder().encode(s);

export function encodeMsgSend(from: string, to: string, amount: string, denom = "uqor"): Uint8Array {
  const coin = Uint8Array.from([...field(1, text(denom)), ...field(2, text(amount))]);
  return Uint8Array.from([...field(1, text(from)), ...field(2, text(to)), ...field(3, coin)]);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
