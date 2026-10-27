// SPDX-License-Identifier: Apache-2.0
//
// The few protobuf messages the mock writes or reads: TxBody, AuthInfo and
// Fee (cosmos.tx.v1beta1). Proto3 defaults (0, empty) are omitted, as in the
// canonical encoding.

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function varint(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) throw new Error("negative varint");
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return Uint8Array.from(out);
}

function tag(field: number, wire: number): Uint8Array {
  return varint((field << 3) | wire);
}

export function lenField(field: number, payload: Uint8Array): Uint8Array {
  return concat(tag(field, WIRE_LEN), varint(payload.length), payload);
}

export function stringField(field: number, value: string): Uint8Array {
  return value === "" ? new Uint8Array() : lenField(field, new TextEncoder().encode(value));
}

export function varintField(field: number, value: number | bigint): Uint8Array {
  return BigInt(value) === 0n ? new Uint8Array() : concat(tag(field, WIRE_VARINT), varint(value));
}

export interface Field {
  field: number;
  wire: number;
  varint?: bigint;
  bytes?: Uint8Array;
  raw: Uint8Array;
}

function readVarint(buf: Uint8Array, at: number): [bigint, number] {
  let v = 0n;
  let shift = 0n;
  for (let i = at; i < buf.length && i < at + 10; i++) {
    const b = buf[i]!;
    v |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [v, i + 1];
    shift += 7n;
  }
  throw new Error("malformed protobuf varint");
}

export function readFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  while (at < buf.length) {
    const start = at;
    const [key, next] = readVarint(buf, at);
    at = next;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    const f: Field = { field, wire, raw: new Uint8Array() };
    if (wire === WIRE_VARINT) {
      [f.varint, at] = readVarint(buf, at);
    } else if (wire === WIRE_LEN) {
      const [len, after] = readVarint(buf, at);
      const end = after + Number(len);
      if (end > buf.length) throw new Error("malformed protobuf length");
      f.bytes = buf.subarray(after, end);
      at = end;
    } else if (wire === WIRE_FIXED64) {
      at += 8;
    } else if (wire === WIRE_FIXED32) {
      at += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
    if (at > buf.length) throw new Error("malformed protobuf field");
    f.raw = buf.subarray(start, at);
    out.push(f);
  }
  return out;
}

export interface AnyMsg {
  typeUrl: string;
  value: Uint8Array;
}

export function encodeAny(m: AnyMsg): Uint8Array {
  return concat(stringField(1, m.typeUrl), lenField(2, m.value));
}

/** `TxBody { messages = 1; memo = 2 }`. */
export function encodeTxBody(messages: readonly AnyMsg[], memo: string): Uint8Array {
  return concat(...messages.map((m) => lenField(1, encodeAny(m))), stringField(2, memo));
}

export interface Coin {
  denom: string;
  amount: string;
}

function encodeCoin(c: Coin): Uint8Array {
  return concat(stringField(1, c.denom), stringField(2, c.amount));
}

/** `Fee { amount = 1; gas_limit = 2 }` plus raw payer / granter fields kept from a decoded fee. */
export function encodeFee(amount: readonly Coin[], gasLimit: bigint, extra: Uint8Array[] = []): Uint8Array {
  return concat(...amount.map((c) => lenField(1, encodeCoin(c))), varintField(2, gasLimit), ...extra);
}

/** `AuthInfo` for one SIGN_MODE_DIRECT signer with a secp256k1 key. */
export function encodeAuthInfo(args: {
  publicKey: Uint8Array;
  sequence: bigint;
  fee: readonly Coin[];
  gasLimit: bigint;
}): Uint8Array {
  const pubKeyAny = encodeAny({ typeUrl: "/cosmos.crypto.secp256k1.PubKey", value: lenField(1, args.publicKey) });
  const single = varintField(1, 1); // SIGN_MODE_DIRECT
  const modeInfo = lenField(1, single);
  const signerInfo = concat(lenField(1, pubKeyAny), lenField(2, modeInfo), varintField(3, args.sequence));
  return concat(lenField(1, signerInfo), lenField(2, encodeFee(args.fee, args.gasLimit)));
}

export interface DecodedFee {
  amount: Coin[];
  gasLimit: bigint;
  /** payer, granter and unknown fields, re-emitted as they were. */
  rest: Uint8Array[];
}

export function decodeFee(bytes: Uint8Array): DecodedFee {
  const out: DecodedFee = { amount: [], gasLimit: 0n, rest: [] };
  for (const f of readFields(bytes)) {
    if (f.field === 1 && f.bytes) {
      const coin: Coin = { denom: "", amount: "" };
      for (const c of readFields(f.bytes)) {
        if (c.field === 1 && c.bytes) coin.denom = new TextDecoder().decode(c.bytes);
        if (c.field === 2 && c.bytes) coin.amount = new TextDecoder().decode(c.bytes);
      }
      out.amount.push(coin);
    } else if (f.field === 2 && f.varint !== undefined) {
      out.gasLimit = f.varint;
    } else {
      out.rest.push(f.raw);
    }
  }
  return out;
}

/** The fee of an AuthInfo, or an empty fee when it has none. */
export function readAuthInfoFee(authInfoBytes: Uint8Array): DecodedFee {
  const fee = readFields(authInfoBytes).find((f) => f.field === 2 && f.bytes);
  return fee?.bytes ? decodeFee(fee.bytes) : { amount: [], gasLimit: 0n, rest: [] };
}

/** The same AuthInfo with its fee replaced; every other field is kept byte for byte. */
export function replaceAuthInfoFee(authInfoBytes: Uint8Array, fee: Uint8Array): Uint8Array {
  const fields = readFields(authInfoBytes);
  const parts: Uint8Array[] = [];
  let replaced = false;
  for (const f of fields) {
    if (f.field === 2) {
      if (!replaced) parts.push(lenField(2, fee));
      replaced = true;
    } else {
      parts.push(f.raw);
    }
  }
  if (!replaced) {
    // Keep canonical field order: signer_infos (1) before fee (2).
    const at = parts.findIndex((_, i) => fields[i]!.field > 2);
    if (at === -1) parts.push(lenField(2, fee));
    else parts.splice(at, 0, lenField(2, fee));
  }
  return concat(...parts);
}

/** Type URLs of the messages in a TxBody. */
export function bodyMessageTypeUrls(bodyBytes: Uint8Array): string[] {
  return readFields(bodyBytes)
    .filter((f) => f.field === 1 && f.bytes)
    .map((f) => {
      const t = readFields(f.bytes!).find((x) => x.field === 1 && x.bytes);
      return t?.bytes ? new TextDecoder().decode(t.bytes) : "";
    });
}
