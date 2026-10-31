#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 QoreChain
//
// Validates the chain registry files under registry/ against the rules of the
// three upstream registries (ethereum-lists/chains, chainapsis/keplr-chain-registry,
// cosmos/chain-registry) and re-checks every value against the live QoreChain
// endpoints.
//
// Usage:
//   node registry/scripts/validate.mjs [--offline] [--no-upstream]
//
//   --offline      skip the live endpoint checks
//   --no-upstream  skip fetching the upstream schemas, rules and current files
//
// Requires Node 22 or newer (global fetch and WebSocket). No dependencies.
// Exit code 0 when every check passes (warnings allowed), 1 otherwise.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const OFFLINE = ARGS.has("--offline");
const NO_UPSTREAM = ARGS.has("--no-upstream");

const EL_RAW = "https://raw.githubusercontent.com/ethereum-lists/chains";
const KEPLR_RAW = "https://raw.githubusercontent.com/chainapsis/keplr-chain-registry/main";
const CR_RAW = "https://raw.githubusercontent.com/cosmos/chain-registry/master";
const GH_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// reporting

let nPass = 0;
let nFail = 0;
let nWarn = 0;
const failList = [];
const warnList = [];
let current = "";

function section(title) {
  current = title;
  console.log(`\n== ${title}`);
}
function ok(msg) {
  nPass++;
  console.log(`  ok    ${msg}`);
}
function bad(msg) {
  nFail++;
  failList.push(`[${current}] ${msg}`);
  console.log(`  FAIL  ${msg}`);
}
function warn(msg) {
  nWarn++;
  warnList.push(`[${current}] ${msg}`);
  console.log(`  warn  ${msg}`);
}
function info(msg) {
  console.log(`  info  ${msg}`);
}
function check(cond, msg, detail) {
  if (cond) ok(msg);
  else bad(detail === undefined ? msg : `${msg} (${detail})`);
  return Boolean(cond);
}

// ---------------------------------------------------------------------------
// helpers

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const rel = (p) => relative(ROOT, p);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function diffPaths(a, b, path = "") {
  if (deepEqual(a, b)) return [];
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => diffPaths(a[k], b[k], `${path}/${k}`));
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((x, i) => diffPaths(x, b[i], `${path}/${i}`));
  }
  const show = (v) => (v === undefined ? "(absent)" : JSON.stringify(v).slice(0, 90));
  return [`${path || "/"}: ${show(a)} -> ${show(b)}`];
}

// Strict JSON parser that also reports duplicate keys (JSON.parse silently keeps the last one).
function parseStrictJson(text, file) {
  let i = 0;
  const dups = [];
  const fail = (m) => {
    throw new Error(`${file}: ${m} at offset ${i}`);
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const str = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") i += 2;
      else if (text[i] === '"') return JSON.parse(text.slice(start, ++i));
      else i++;
    }
    return fail("unterminated string");
  };
  const value = (path) => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const o = {};
      ws();
      if (text[i] === "}") {
        i++;
        return o;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail("expected a key");
        const k = str();
        ws();
        if (text[i++] !== ":") fail("expected ':'");
        if (Object.prototype.hasOwnProperty.call(o, k)) dups.push(`${path}/${k}`);
        o[k] = value(`${path}/${k}`);
        ws();
        const d = text[i++];
        if (d === "}") return o;
        if (d !== ",") fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const a = [];
      ws();
      if (text[i] === "]") {
        i++;
        return a;
      }
      for (;;) {
        a.push(value(`${path}/${a.length}`));
        ws();
        const d = text[i++];
        if (d === "]") return a;
        if (d !== ",") fail("expected ',' or ']'");
      }
    }
    if (c === '"') return str();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) fail("unexpected token");
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  const v = value("");
  ws();
  if (i !== text.length) fail("trailing data");
  return { value: v, dups };
}

const loaded = new Map();
function loadJson(path) {
  if (loaded.has(path)) return loaded.get(path);
  const text = readFileSync(path, "utf8");
  const { value, dups } = parseStrictJson(text, rel(path));
  const out = { text, value, dups };
  loaded.set(path, out);
  return out;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngInfo(path) {
  const buf = readFileSync(path);
  const isPng = buf.subarray(0, 8).equals(PNG_SIG);
  return {
    isPng,
    width: isPng ? buf.readUInt32BE(16) : null,
    height: isPng ? buf.readUInt32BE(20) : null,
    colorType: isPng ? buf[25] : null,
    bytes: buf.length,
    buf,
  };
}

// IPFS CIDv0 of a file small enough for a single chunk (default `ipfs add`:
// 256 KiB chunks, dag-pb leaves, no raw leaves).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(buf) {
  let x = BigInt(`0x${buf.toString("hex")}`);
  let s = "";
  while (x > 0n) {
    s = B58[Number(x % 58n)] + s;
    x /= 58n;
  }
  for (const c of buf) {
    if (c !== 0) break;
    s = `1${s}`;
  }
  return s;
}
function varint(n) {
  const out = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}
function cidV0SingleChunk(data) {
  if (data.length > 262144) return null;
  const field = (tag, b) => Buffer.concat([Buffer.from([tag]), varint(b.length), b]);
  const unixfs = Buffer.concat([Buffer.from([0x08, 0x02]), field(0x12, data), Buffer.from([0x18]), varint(data.length)]);
  const node = field(0x0a, unixfs);
  return base58(Buffer.concat([Buffer.from([0x12, 0x20]), createHash("sha256").update(node).digest()]));
}

async function http(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": "qorechain-registry-validate", ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeout || 20000),
  });
  return res;
}
async function getJson(url) {
  const r = await http(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await http(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}
async function status(url) {
  try {
    const r = await http(url, { redirect: "follow" });
    return r.status;
  } catch (e) {
    return `error: ${e.message}`;
  }
}
async function jsonRpc(url, method, params) {
  const r = await http(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params === undefined ? { jsonrpc: "2.0", id: 1, method } : { jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${method} at ${url}`);
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
function wsCall(url, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    if (typeof WebSocket !== "function") {
      resolve({ ok: false, error: "no global WebSocket in this Node version (22+ needed)" });
      return;
    }
    let done = false;
    let ws;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      finish({ ok: false, error: e.message });
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify(payload));
    ws.onmessage = (m) => {
      try {
        finish({ ok: true, data: JSON.parse(String(m.data)) });
      } catch (e) {
        finish({ ok: false, error: e.message });
      }
    };
    ws.onerror = (e) => finish({ ok: false, error: e?.message || "connection error" });
  });
}
const b64ToHex = (b64) => Buffer.from(b64, "base64").toString("hex").toUpperCase();

// ---------------------------------------------------------------------------
// minimal JSON Schema validator (the draft-07 / 2019-09 keywords used by the
// upstream schemas: $ref into $defs/definitions, type, enum, const, string,
// number, array and object constraints, allOf/anyOf/oneOf/not, if/then/else)

function re(pattern) {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return new RegExp(pattern);
  }
}

function schemaErrors(root, data) {
  const resolve = (ref) => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
    return ref
      .slice(2)
      .split("/")
      .reduce((o, k) => o[k.replace(/~1/g, "/").replace(/~0/g, "~")], root);
  };
  const typeOk = (t, d) =>
    t === "object"
      ? isObj(d)
      : t === "array"
        ? Array.isArray(d)
        : t === "integer"
          ? Number.isInteger(d)
          : t === "number"
            ? typeof d === "number"
            : t === "null"
              ? d === null
              : typeof d === t;
  const v = (s, d, p) => {
    if (s === true || s === undefined) return [];
    if (s === false) return [`${p || "/"}: not allowed`];
    const e = [];
    if (s.$ref) e.push(...v(resolve(s.$ref), d, p));
    if (s.type) {
      const types = [].concat(s.type);
      if (!types.some((t) => typeOk(t, d))) return [...e, `${p || "/"}: expected ${types.join("|")}`];
    }
    if (s.enum && !s.enum.some((x) => deepEqual(x, d))) e.push(`${p || "/"}: ${JSON.stringify(d)} not in enum`);
    if ("const" in s && !deepEqual(s.const, d)) e.push(`${p || "/"}: must equal ${JSON.stringify(s.const)}`);
    if (typeof d === "string") {
      if (s.minLength !== undefined && [...d].length < s.minLength) e.push(`${p}: shorter than ${s.minLength}`);
      if (s.maxLength !== undefined && [...d].length > s.maxLength) e.push(`${p}: longer than ${s.maxLength}`);
      if (s.pattern && !re(s.pattern).test(d)) e.push(`${p}: does not match ${s.pattern}`);
      if (s.format === "uri") {
        try {
          new URL(d);
        } catch {
          e.push(`${p}: not a URI`);
        }
      }
    }
    if (typeof d === "number") {
      if (s.minimum !== undefined && d < s.minimum) e.push(`${p}: below ${s.minimum}`);
      if (s.maximum !== undefined && d > s.maximum) e.push(`${p}: above ${s.maximum}`);
      if (s.exclusiveMinimum !== undefined && typeof s.exclusiveMinimum === "number" && d <= s.exclusiveMinimum)
        e.push(`${p}: not above ${s.exclusiveMinimum}`);
    }
    if (Array.isArray(d)) {
      if (s.minItems !== undefined && d.length < s.minItems) e.push(`${p}: fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && d.length > s.maxItems) e.push(`${p}: more than ${s.maxItems} items`);
      if (s.uniqueItems && d.some((x, i) => d.findIndex((y) => deepEqual(x, y)) !== i)) e.push(`${p}: items not unique`);
      if (Array.isArray(s.items)) d.forEach((x, i) => e.push(...v(s.items[i], x, `${p}/${i}`)));
      else if (s.items) d.forEach((x, i) => e.push(...v(s.items, x, `${p}/${i}`)));
      if (s.contains) {
        const n = d.filter((x) => v(s.contains, x, p).length === 0).length;
        const min = s.minContains ?? 1;
        if (n < min) e.push(`${p}: contains fewer than ${min} matching items`);
        if (s.maxContains !== undefined && n > s.maxContains) e.push(`${p}: contains more than ${s.maxContains}`);
      }
    }
    if (isObj(d)) {
      for (const r of s.required || []) if (!(r in d)) e.push(`${p || "/"}: missing required "${r}"`);
      const keys = Object.keys(d);
      if (s.minProperties !== undefined && keys.length < s.minProperties) e.push(`${p}: fewer than ${s.minProperties} properties`);
      if (s.maxProperties !== undefined && keys.length > s.maxProperties) e.push(`${p}: more than ${s.maxProperties} properties`);
      for (const k of keys) {
        let matched = false;
        if (s.properties && k in s.properties) {
          matched = true;
          e.push(...v(s.properties[k], d[k], `${p}/${k}`));
        }
        for (const [pat, ps] of Object.entries(s.patternProperties || {})) {
          if (re(pat).test(k)) {
            matched = true;
            e.push(...v(ps, d[k], `${p}/${k}`));
          }
        }
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) e.push(`${p || "/"}: additional property "${k}" not allowed`);
          else e.push(...v(s.additionalProperties, d[k], `${p}/${k}`));
        }
        if (s.propertyNames) e.push(...v(s.propertyNames, k, `${p}/${k}(name)`));
      }
      for (const [k, deps] of Object.entries(s.dependentRequired || {}))
        if (k in d) for (const r of deps) if (!(r in d)) e.push(`${p}: "${k}" requires "${r}"`);
    }
    for (const sub of s.allOf || []) e.push(...v(sub, d, p));
    if (s.anyOf && !s.anyOf.some((sub) => v(sub, d, p).length === 0)) e.push(`${p || "/"}: matches none of anyOf`);
    if (s.oneOf && s.oneOf.filter((sub) => v(sub, d, p).length === 0).length !== 1) e.push(`${p || "/"}: must match exactly one of oneOf`);
    if (s.not && v(s.not, d, p).length === 0) e.push(`${p || "/"}: must not match "not" schema`);
    if (s.if) {
      if (v(s.if, d, p).length === 0) e.push(...v(s.then, d, p));
      else e.push(...v(s.else, d, p));
    }
    return e;
  };
  return v(root, data, "");
}

// ---------------------------------------------------------------------------
// prettier-equivalent JSON layout for ethereum-lists (printWidth/tabWidth from
// the upstream .prettierrc.json): objects stay expanded, arrays are printed on
// one line when they hold only scalars or flat objects and the line fits.

function prettierLayout(value, printWidth = 80, tab = 2) {
  const flat = (x) => !isObj(x) || Object.values(x).every((y) => y === null || typeof y !== "object");
  const inline = (x) =>
    isObj(x)
      ? Object.keys(x).length === 0
        ? "{}"
        : `{ ${Object.entries(x)
            .map(([k, y]) => `${JSON.stringify(k)}: ${JSON.stringify(y)}`)
            .join(", ")} }`
      : JSON.stringify(x);
  const fmt = (v, ind, lead, trailing) => {
    const pad = " ".repeat(ind);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const one = `[${v.map(inline).join(", ")}]`;
      if (v.every(flat) && !v.some(Array.isArray) && lead + one.length + trailing <= printWidth) return one;
      const inner = " ".repeat(ind + tab);
      return `[\n${v.map((x, i) => inner + fmt(x, ind + tab, ind + tab, i < v.length - 1 ? 1 : 0)).join(",\n")}\n${pad}]`;
    }
    if (isObj(v)) {
      const entries = Object.entries(v);
      if (entries.length === 0) return "{}";
      const inner = " ".repeat(ind + tab);
      return `{\n${entries
        .map(([k, x], i) => {
          const head = `${inner}${JSON.stringify(k)}: `;
          return head + fmt(x, ind + tab, head.length, i < entries.length - 1 ? 1 : 0);
        })
        .join(",\n")}\n${pad}}`;
    }
    return JSON.stringify(v);
  };
  return `${fmt(value, 0, 0, 0)}\n`;
}

// ---------------------------------------------------------------------------
// content policy for files that will be published

const join2 = (...parts) => parts.join("");
const POLICY_ALL = [
  [new RegExp(String.fromCharCode(0x2014), "u"), "em dash"],
  [new RegExp(String.fromCharCode(0x2013), "u"), "en dash"],
  [new RegExp(`${join2("comet", "bft")}|${join2("tender", "mint")}`, "i"), "upstream consensus engine name"],
  [new RegExp(join2("base/", "tender", "mint/v1beta1/node", "_info")), "node info REST path"],
  [new RegExp(join2("quantum", "[- ]?(safe|proof|resistant)"), "i"), "security superlative"],
  [new RegExp(`\\b(${join2("Cla", "ude")}|${join2("Anthr", "opic")}|${join2("L", "LM")}|${join2("G", "PT")}|${join2("A", "I")})\\b`), "tooling attribution"],
  [new RegExp(join2("/", "Users", "/")), "local filesystem path"],
  [new RegExp(join2("~/", "Development")), "local filesystem path"],
  [new RegExp(join2("\\bQ", "SR-\\d+")), "internal tracker id"],
  [/\bUSDT?\b|\bMEXC\b|\$\s?\d/u, "price or market reference"],
];
const POLICY_JSON_VALUES = [[/\b(first|only)\b/i, "superlative claim in a value"]];

function jsonStrings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => jsonStrings(x, out));
  else if (isObj(v)) Object.values(v).forEach((x) => jsonStrings(x, out));
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// ---------------------------------------------------------------------------
// paths

const EL = join(ROOT, "ethereum-lists");
const KP = join(ROOT, "keplr-chain-registry");
const CR = join(ROOT, "chain-registry");

const NETS = [
  {
    key: "mainnet",
    eip155: join(EL, "eip155-9801.json"),
    keplr: join(KP, "cosmos", "qorechain-vladi.json"),
    crDir: join(CR, "qorechain"),
    crRel: "qorechain",
  },
  {
    key: "testnet",
    eip155: join(EL, "eip155-9800.json"),
    keplr: join(KP, "cosmos", "qorechain-diana.json"),
    crDir: join(CR, "testnets", "qorechaintestnet"),
    crRel: "testnets/qorechaintestnet",
  },
];

// Keplr rules: @keplr-wallet/chain-validator 0.13.16 (the version pinned by
// keplr-chain-registry) plus keplr-chain-registry src/validate.ts and src/index.ts.
const KEPLR_VALIDATOR_VERSION = "0.13.16";
const KEPLR_SUPPORTED_FEATURES = [
  "stargate", "cosmwasm", "wasmd_0.24+", "secretwasm", "ibc-transfer", "no-legacy-stdTx", "ibc-go",
  "eth-address-gen", "eth-key-sign", "query:/cosmos/bank/v1beta1/spendable_balances", "axelar-evm-bridge",
  "osmosis-txfees", "terra-classic-fee", "ibc-go-v7-hot-fix", "ibc-pfm", "authz-msg-revoke-fixed",
  "osmosis-base-fee-beta", "feemarket", "evm-feemarket", "op-stack-l1-data-fee", "force-enable-evm-ledger",
  "ibc-v2", "evm-ledger-sign-plain-json", "initia-dynamicfee", "eth-secp256k1-initia", "eth-secp256k1-cosmos",
  "/cosmos.evm.types.v1.ExtensionOptionsWeb3Tx",
];
const KEPLR_RECOGNIZABLE = ["ibc-go", "ibc-transfer", "wasmd_0.24+", "query:/cosmos/bank/v1beta1/spendable_balances", "feemarket", "ibc-v2"];
const KEPLR_NON_RECOGNIZABLE = KEPLR_SUPPORTED_FEATURES.filter((f) => !KEPLR_RECOGNIZABLE.includes(f));
const KEPLR_TOP_KEYS = new Set([
  "rpc", "rest", "evm", "nodeProvider", "chainId", "chainName", "stakeCurrency", "walletUrl", "walletUrlForStaking",
  "bip44", "alternativeBIP44s", "bech32Config", "currencies", "feeCurrencies", "beta", "features",
  "chainSymbolImageUrl", "hideInUI", "isTestnet", "explorers",
]);
const KEPLR_CURRENCY_KEYS = new Set(["coinDenom", "coinMinimalDenom", "coinDecimals", "coinGeckoId", "coinImageUrl", "nonTransferable"]);
const keplrIdentifier = (chainId) => {
  const m = /^(.+)-([\d]+)$/.exec(chainId);
  return m ? m[1] : chainId;
};

// ---------------------------------------------------------------------------
// 1. ethereum-lists (local rules)

function checkEthereumLists() {
  section("ethereum-lists: local rules (processor checks + schemaCheck.js)");
  const MANDATORY = ["name", "shortName", "chain", "chainId", "networkId", "rpc", "faucets", "infoURL", "nativeCurrency"];
  const OPTIONAL = ["features", "slip44", "ens", "icon", "explorers", "title", "parent", "status", "redFlags"];
  const NAME_RE = /^[a-zA-Z0-9\-.() ]+$/;
  const trimmed = (s) => typeof s === "string" && s.trim() === s && s.length > 0;
  const usedIcons = new Set();
  for (const net of NETS) {
    const f = rel(net.eip155);
    const { value: c, text, dups } = loadJson(net.eip155);
    check(dups.length === 0, `${f}: no duplicate keys`, dups.join(", "));
    check(`eip155-${c.chainId}.json` === basename(net.eip155), `${f}: file name matches chainId ${c.chainId}`);
    check(Number.isInteger(c.networkId), `${f}: networkId is an integer`);
    const extra = Object.keys(c).filter((k) => !MANDATORY.includes(k) && !OPTIONAL.includes(k));
    const missing = MANDATORY.filter((k) => !(k in c));
    check(extra.length === 0, `${f}: no extra fields`, extra.join(", "));
    check(missing.length === 0, `${f}: no missing mandatory fields`, missing.join(", "));
    const nc = c.nativeCurrency || {};
    check(deepEqual(Object.keys(nc).sort(), ["decimals", "name", "symbol"]), `${f}: nativeCurrency has exactly name/symbol/decimals`);
    check(trimmed(nc.symbol) && nc.symbol.length < 7, `${f}: nativeCurrency.symbol "${nc.symbol}" trimmed and under 7 chars`);
    check(Number.isInteger(nc.decimals), `${f}: nativeCurrency.decimals is an integer`);
    check(NAME_RE.test(nc.name || ""), `${f}: nativeCurrency.name "${nc.name}" uses allowed characters`);
    check(NAME_RE.test(c.name || ""), `${f}: name "${c.name}" uses allowed characters`);
    check(/^[A-Za-z0-9-_]{1,64}$/.test(c.shortName || "") && c.shortName !== "*", `${f}: shortName "${c.shortName}" valid`);
    check(Array.isArray(c.rpc) && c.rpc.length > 0 && c.rpc.every((u) => trimmed(u) && /^(https?|wss?):\/\//.test(u)), `${f}: rpc is a list of http(s)/ws(s) URLs`);
    check(Array.isArray(c.faucets) && c.faucets.every(trimmed), `${f}: faucets is a list of strings`);
    check(/^https?:\/\//.test(c.infoURL || "") && trimmed(c.infoURL), `${f}: infoURL is an http(s) URL`);
    if (c.status !== undefined) check(["active", "incubating", "deprecated"].includes(c.status), `${f}: status valid`);
    if (c.features !== undefined)
      check(Array.isArray(c.features) && c.features.every((x) => isObj(x) && typeof x.name === "string"), `${f}: features is a list of {name}`);
    for (const e of c.explorers || []) {
      check(trimmed(e.name), `${f}: explorer has a name`);
      check(/^https?:\/\//.test(e.url || "") && !e.url.endsWith("/") && trimmed(e.url), `${f}: explorer url ${e.url} is http(s) without trailing slash`);
      check(["EIP3091", "none"].includes(e.standard), `${f}: explorer standard "${e.standard}" is EIP3091 or none`);
    }
    if (c.icon) {
      usedIcons.add(c.icon);
      check(existsSync(join(EL, "icons", `${c.icon}.json`)), `${f}: icon "${c.icon}" has icons/${c.icon}.json`);
    }
    if (/testnet/i.test(c.name)) check(c.slip44 === 1, `${f}: testnet uses slip44 1`);
    check(text === prettierLayout(c), `${f}: layout matches prettier (printWidth 80, tabWidth 2)`);
  }
  const chainsByName = new Map();
  for (const net of NETS) {
    const c = loadJson(net.eip155).value;
    const n = c.name.replace(/ /g, "").toUpperCase();
    check(!chainsByName.has(n), `name "${c.name}" unique within this set`);
    chainsByName.set(n, c);
  }
  for (const icon of usedIcons) {
    const p = join(EL, "icons", `${icon}.json`);
    const { value: variants, text } = loadJson(p);
    check(Array.isArray(variants) && variants.length > 0, `icons/${icon}.json is a non-empty array`);
    check(text === prettierLayout(variants), `icons/${icon}.json layout matches prettier`);
    for (const v of variants) {
      check(typeof v.url === "string" && v.url.startsWith("ipfs://"), `icons/${icon}.json url starts with ipfs://`);
      check(Number.isInteger(v.width) && Number.isInteger(v.height) && v.width > 0 && v.height > 0, `icons/${icon}.json width/height are positive integers`);
      check(["png", "svg", "jpg"].includes(v.format), `icons/${icon}.json format "${v.format}" is png, svg or jpg`);
      // The ethereum-lists icon is the same master PNG as the chain-registry logo.
      const master = join(CR, "qorechain", "images", "qorechain.png");
      const png = pngInfo(master);
      const cid = cidV0SingleChunk(png.buf);
      check(cid === v.url.slice(7), `icons/${icon}.json CID matches the master icon PNG`, `computed ${cid}`);
      check(png.isPng && v.format === "png", `icons/${icon}.json format matches the file (png)`);
      check(png.width === v.width && png.height === v.height, `icons/${icon}.json size ${v.width}x${v.height} matches the file (${png.width}x${png.height})`);
      check(png.bytes < 250 * 1024, `icon file is under 250 KB (${png.bytes} bytes)`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Keplr (local rules)

function checkKeplr() {
  section(`keplr-chain-registry: local rules (chain-validator ${KEPLR_VALIDATOR_VERSION} + src/validate.ts + src/index.ts)`);
  for (const net of NETS) {
    const f = rel(net.keplr);
    const { value: c, dups } = loadJson(net.keplr);
    check(dups.length === 0, `${f}: no duplicate keys`, dups.join(", "));
    const ident = keplrIdentifier(c.chainId);
    check(basename(net.keplr) === `${ident}.json`, `${f}: file name matches chain identifier "${ident}"`);
    const extra = Object.keys(c).filter((k) => !KEPLR_TOP_KEYS.has(k));
    check(extra.length === 0, `${f}: no unknown fields`, extra.join(", "));
    check(typeof c.chainName === "string" && c.chainName.length >= 1 && c.chainName.length <= 36, `${f}: chainName length 1..36`);
    check(typeof c.chainId === "string" && c.chainId.length <= 50, `${f}: chainId is a string up to 50 chars`);
    check(/^https:\/\//.test(c.rpc) && /^https:\/\//.test(c.rest), `${f}: rpc and rest are https`);
    check(Number.isInteger(c.bip44?.coinType) && c.bip44.coinType >= 0, `${f}: bip44.coinType integer`);
    const b = c.bech32Config || {};
    const want = ["bech32PrefixAccAddr", "bech32PrefixAccPub", "bech32PrefixValAddr", "bech32PrefixValPub", "bech32PrefixConsAddr", "bech32PrefixConsPub"];
    check(want.every((k) => typeof b[k] === "string" && b[k].length > 0) && Object.keys(b).length === 6, `${f}: bech32Config complete`);
    const np = c.nodeProvider || {};
    check(typeof np.name === "string" && np.name.length >= 1 && np.name.length <= 30, `${f}: nodeProvider.name present (1..30 chars)`);
    check(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(np.email || ""), `${f}: nodeProvider.email present`);
    check(Boolean(c.chainSymbolImageUrl), `${f}: chainSymbolImageUrl present`);
    const currencies = [...(c.currencies || []), ...(c.feeCurrencies || []), ...(c.stakeCurrency ? [c.stakeCurrency] : [])];
    for (const cur of currencies) {
      const unknown = Object.keys(cur).filter((k) => !KEPLR_CURRENCY_KEYS.has(k) && k !== "gasPriceStep");
      check(unknown.length === 0, `${f}: currency ${cur.coinMinimalDenom} has no unknown fields`, unknown.join(", "));
      check(Number.isInteger(cur.coinDecimals) && cur.coinDecimals >= 0 && cur.coinDecimals <= 18, `${f}: ${cur.coinMinimalDenom} coinDecimals 0..18`);
      if (c.isTestnet) check(!cur.coinGeckoId, `${f}: testnet has no coinGeckoId`);
    }
    check((c.currencies || []).length >= 1 && (c.feeCurrencies || []).length >= 1, `${f}: currencies and feeCurrencies not empty`);
    for (const fc of c.feeCurrencies || []) {
      check(c.currencies.some((x) => x.coinMinimalDenom === fc.coinMinimalDenom), `${f}: fee currency ${fc.coinMinimalDenom} is in currencies`);
      const g = fc.gasPriceStep;
      if (g) check([g.low, g.average, g.high].every((n) => typeof n === "number") && g.low <= g.average && g.average <= g.high, `${f}: gasPriceStep low <= average <= high`);
    }
    if (c.stakeCurrency)
      check(c.currencies.some((x) => x.coinMinimalDenom === c.stakeCurrency.coinMinimalDenom), `${f}: stake currency is in currencies`);
    for (const cur of c.currencies || []) check(!cur.coinMinimalDenom.startsWith("ibc/"), `${f}: no ibc currency in currencies`);
    const feats = c.features || [];
    check(new Set(feats).size === feats.length, `${f}: features unique`);
    for (const ft of feats) check(KEPLR_NON_RECOGNIZABLE.includes(ft) || ft === "ibc-v2", `${f}: feature "${ft}" is a non-recognizable feature`);
    check(!feats.includes("stargate") && !feats.includes("no-legacy-stdTx"), `${f}: no deprecated features`);
    check(c.beta === undefined && c.hideInUI === undefined, `${f}: no beta/hideInUI`);
    const looksTest = /testnet|devnet/i.test(c.chainName) || /testnet|devnet/.test(c.chainId);
    if (looksTest) check(c.isTestnet === true, `${f}: isTestnet set for a testnet name/chain id`);
    if (c.bip44?.coinType === 60) check(feats.includes("eth-address-gen") && feats.includes("eth-key-sign"), `${f}: coin type 60 has eth features`);
    if (c.explorers) check(/\{txHash(:lowercase|:uppercase)?\}/.test(c.explorers.txPage || ""), `${f}: explorers.txPage has a {txHash} placeholder`);
    const base = `https://raw.githubusercontent.com/chainapsis/keplr-chain-registry/main/images/${ident}/`;
    const urls = [c.chainSymbolImageUrl, c.stakeCurrency?.coinImageUrl, ...currencies.map((x) => x.coinImageUrl)].filter(Boolean);
    for (const u of new Set(urls)) {
      check(u.startsWith(base) && u.endsWith(".png"), `${f}: image url under images/${ident}/ and .png`);
      const p = join(KP, "images", ident, u.slice(base.length));
      if (check(existsSync(p), `${rel(p)} exists`)) {
        const png = pngInfo(p);
        check(png.isPng && png.width === 256 && png.height === 256, `${rel(p)} is a 256x256 PNG`, `${png.width}x${png.height}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. cosmos/chain-registry (local rules, subset of validate_data.mjs)

function crUriToLocal(uri) {
  const prefix = "https://raw.githubusercontent.com/cosmos/chain-registry/master/";
  return uri.startsWith(prefix) ? join(CR, uri.slice(prefix.length)) : null;
}

function checkChainRegistry() {
  section("cosmos/chain-registry: local rules (subset of .github/workflows/utility/validate_data.mjs)");
  const assetsByChain = new Map();
  for (const net of NETS) {
    const al = loadJson(join(net.crDir, "assetlist.json")).value;
    assetsByChain.set(al.chain_name, al.assets);
  }
  const allImageUris = new Set();
  for (const net of NETS) {
    const files = ["chain.json", "assetlist.json", "versions.json"].map((n) => join(net.crDir, n));
    for (const p of files) {
      const { value, dups } = loadJson(p);
      check(dups.length === 0, `${rel(p)}: valid JSON, no duplicate keys`, dups.join(", "));
      const depth = net.crRel.split("/").length;
      const want = `${"../".repeat(depth)}${basename(p).replace(".json", ".schema.json")}`;
      check(value.$schema === want, `${rel(p)}: $schema is ${want}`);
    }
    const chain = loadJson(files[0]).value;
    const assets = loadJson(files[1]).value;
    const versions = loadJson(files[2]).value;
    const f = rel(files[0]);
    check(chain.chain_name === basename(net.crDir), `${f}: chain_name matches directory`);
    check(assets.chain_name === chain.chain_name && versions.chain_name === chain.chain_name, `${net.crRel}: chain_name consistent across files`);
    check((chain.network_type === "mainnet") === !net.crRel.startsWith("testnets/"), `${f}: network_type matches directory location`);
    if (chain.status === "live" && chain.chain_type === "cosmos") check(chain.slip44 !== undefined, `${f}: live chain has slip44`);
    const pat = { rpc: /^https?:\/\/\S+$/, rest: /^https?:\/\/\S+$/, "evm-http-jsonrpc": /^https?:\/\/\S+$/, wss: /^wss?:\/\/\S+$/ };
    for (const [t, list] of Object.entries(chain.apis || {}))
      for (const e of list) if (pat[t]) check(pat[t].test(e.address), `${f}: apis.${t} ${e.address} well formed`);
    const own = assetsByChain.get(chain.chain_name) || [];
    for (const ft of chain.fees?.fee_tokens || []) {
      check(own.some((a) => a.base === ft.denom), `${f}: fee token ${ft.denom} is in the assetlist`);
      const xs = [ft.fixed_min_gas_price, ft.low_gas_price, ft.average_gas_price, ft.high_gas_price].filter((x) => x !== undefined);
      check(xs.every((x, i) => i === 0 || xs[i - 1] <= x), `${f}: gas prices are ordered min <= low <= average <= high`);
    }
    for (const st of chain.staking?.staking_tokens || []) check(own.some((a) => a.base === st.denom), `${f}: staking token ${st.denom} is in the assetlist`);
    // codebase vs versions.json (compare_CodebaseVersionData_to_VersionsFile)
    const keys = ["recommended_version", "compatible_versions", "tag", "language", "binaries", "sdk", "consensus", "cosmwasm", "ibc"];
    const cb = Object.fromEntries(Object.entries(chain.codebase || {}).filter(([k]) => keys.includes(k)));
    const cur = versions.versions.find((v) => v.recommended_version === chain.codebase?.recommended_version) || {};
    const mism = Object.entries(cb).filter(([k, v]) => !deepEqual(v, cur[k]));
    check(mism.length === 0, `${net.crRel}: codebase matches the versions.json entry for ${chain.codebase?.recommended_version}`, mism.map(([k]) => k).join(", "));
    const names = versions.versions.map((v) => v.name);
    check(new Set(names).size === names.length, `${net.crRel}/versions.json: version names unique`);
    for (const v of versions.versions) {
      if (v.next_version_name) check(names.includes(v.next_version_name), `${net.crRel}/versions.json: ${v.name} next_version_name exists`);
      if (v.previous_version_name) check(names.includes(v.previous_version_name), `${net.crRel}/versions.json: ${v.name} previous_version_name exists`);
    }
    // assets
    for (const a of assets.assets) {
      const fa = `${rel(files[1])} ${a.base}`;
      const base = a.denom_units.find((u) => u.denom === a.base);
      check(base && base.exponent === 0, `${fa}: base unit has exponent 0`);
      check(a.denom_units.some((u) => u.denom === a.display), `${fa}: display unit "${a.display}" is a denom unit`);
      check(typeof a.symbol === "string" && a.symbol.length > 0, `${fa}: symbol set`);
      for (const img of a.images || []) {
        if (img.image_sync) {
          check(Array.isArray(a.traces) && a.traces.length > 0, `${fa}: image_sync is used together with traces`);
          const target = (assetsByChain.get(img.image_sync.chain_name) || []).find((x) => x.base === img.image_sync.base_denom);
          check(Boolean(target), `${fa}: image_sync points at ${img.image_sync.chain_name}/${img.image_sync.base_denom}`);
          if (target) check(deepEqual((target.images || [])[0]?.png, img.png), `${fa}: synced png equals the target's png`);
        }
      }
      for (const t of a.traces || []) {
        const cp = t.counterparty || {};
        check((assetsByChain.get(cp.chain_name) || []).some((x) => x.base === cp.base_denom), `${fa}: trace counterparty ${cp.chain_name}/${cp.base_denom} exists`);
      }
      for (const u of [a.logo_URIs?.png, a.logo_URIs?.svg, ...(a.images || []).flatMap((i) => [i.png, i.svg])].filter(Boolean)) allImageUris.add(u);
    }
    for (const img of chain.images || []) {
      if (img.image_sync) {
        const target = loadJson(join(CR, img.image_sync.chain_name, "chain.json")).value;
        check(Boolean(target), `${f}: chain image_sync points at ${img.image_sync.chain_name}`);
        check(deepEqual(target.images?.[0]?.png, img.png), `${f}: synced chain png equals ${img.image_sync.chain_name}'s png`);
      }
    }
    for (const u of [chain.logo_URIs?.png, chain.logo_URIs?.svg, ...(chain.images || []).flatMap((i) => [i.png, i.svg])].filter(Boolean)) allImageUris.add(u);
  }
  for (const u of allImageUris) {
    const p = crUriToLocal(u);
    if (!check(p && existsSync(p), `image ${u} exists locally`)) continue;
    const st = statSync(p);
    check(st.size <= 251 * 1024, `${rel(p)} is at most 251 KB (${st.size} bytes)`);
    check(basename(p) === basename(p).toLowerCase(), `${rel(p)} has a lowercase file name`);
    if (p.endsWith(".png")) {
      const png = pngInfo(p);
      check(png.isPng, `${rel(p)} has a PNG signature`);
      check(Math.abs(png.width - png.height) <= 1, `${rel(p)} is square (${png.width}x${png.height})`);
    }
  }
  for (const net of NETS) {
    const dir = join(net.crDir, "images");
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) {
      const uri = `https://raw.githubusercontent.com/cosmos/chain-registry/master/${net.crRel}/images/${n}`;
      check(allImageUris.has(uri), `${net.crRel}/images/${n} is referenced`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. consistency across the three registries

function checkConsistency() {
  section("consistency across the three registries");
  for (const net of NETS) {
    const el = loadJson(net.eip155).value;
    const kp = loadJson(net.keplr).value;
    const cr = loadJson(join(net.crDir, "chain.json")).value;
    const al = loadJson(join(net.crDir, "assetlist.json")).value.assets[0];
    const n = net.key;
    check(kp.chainId === cr.chain_id, `${n}: Keplr chainId equals chain-registry chain_id (${cr.chain_id})`);
    check(kp.rpc === cr.apis.rpc[0].address && kp.rest === cr.apis.rest[0].address, `${n}: Keplr rpc/rest equal chain-registry apis`);
    check(deepEqual(el.rpc.filter((u) => u.startsWith("http")), cr.apis["evm-http-jsonrpc"].map((e) => e.address)), `${n}: ethereum-lists http rpc equals chain-registry evm-http-jsonrpc`);
    check(kp.bip44.coinType === cr.slip44, `${n}: coin type ${cr.slip44} in both cosmos registries`);
    check(kp.bech32Config.bech32PrefixAccAddr === cr.bech32_prefix, `${n}: bech32 prefix ${cr.bech32_prefix} in both cosmos registries`);
    const disp = al.denom_units.find((u) => u.denom === al.display);
    check(kp.currencies[0].coinMinimalDenom === al.base && kp.currencies[0].coinDecimals === disp.exponent, `${n}: Keplr ${kp.currencies[0].coinMinimalDenom}/${kp.currencies[0].coinDecimals} equals assetlist ${al.base}/${disp.exponent}`);
    check(kp.currencies[0].coinDenom === al.symbol && el.nativeCurrency.symbol === al.symbol, `${n}: symbol ${al.symbol} in all three registries`);
    const ft = cr.fees.fee_tokens[0];
    const g = kp.feeCurrencies[0].gasPriceStep;
    check(g.low === ft.low_gas_price && g.average === ft.average_gas_price && g.high === ft.high_gas_price, `${n}: gas price steps equal in Keplr and chain-registry`);
    check(el.nativeCurrency.decimals === disp.exponent + 12, `${n}: EVM decimals ${el.nativeCurrency.decimals} = native ${disp.exponent} + 12 (wei per uqor = 10^12)`);
    check(cr.description.includes(`chain id ${el.chainId}`), `${n}: chain-registry description names EVM chain id ${el.chainId}`);
    const exEl = (el.explorers || [])[0]?.url;
    const exCr = (cr.explorers || [])[0]?.url;
    const exKp = kp.explorers?.txPage;
    check(exEl === exCr && (!exKp || exKp.startsWith(`${exCr}/`)), `${n}: explorer base consistent (${exCr ?? "none"})`);
  }
}

// ---------------------------------------------------------------------------
// 5. content policy

function checkPolicy() {
  section("content policy (published files)");
  const files = walk(ROOT).filter((p) => /\.(json|md|mjs)$/.test(p));
  for (const p of files) {
    const text = readFileSync(p, "utf8");
    const hits = POLICY_ALL.filter(([re]) => re.test(text)).map(([, label]) => label);
    if (p.endsWith(".json")) {
      const strings = jsonStrings(loadJson(p).value).filter((s) => !/^(https?|wss?|ipfs):\/\//.test(s));
      for (const [re, label] of POLICY_JSON_VALUES) if (strings.some((s) => re.test(s))) hits.push(label);
    }
    check(hits.length === 0, `${rel(p)}: clean`, [...new Set(hits)].join(", "));
  }
  const script = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 3).join("\n");
  check(script.includes("SPDX-License-Identifier: Apache-2.0"), "validate.mjs carries the Apache-2.0 SPDX header");
}

// ---------------------------------------------------------------------------
// 6. upstream schemas and current upstream files

async function checkUpstream() {
  section("ethereum-lists: upstream JSON schema, prettier config, uniqueness");
  try {
    const schema = await getJson(`${EL_RAW}/master/tools/schema/chainSchema.json`);
    for (const net of NETS) {
      const errs = schemaErrors(schema, loadJson(net.eip155).value);
      check(errs.length === 0, `${rel(net.eip155)}: valid against tools/schema/chainSchema.json`, errs.join("; "));
    }
    const pr = await getJson(`${EL_RAW}/master/.prettierrc.json`);
    const pw = pr.printWidth ?? 80;
    const tw = pr.tabWidth ?? 2;
    check(pw === 80 && tw === 2, `upstream .prettierrc.json still printWidth ${pw} / tabWidth ${tw} (the layout check assumes 80/2)`);
    const mini = await getJson(`${EL_RAW}/gh-pages/chains_mini.json`);
    for (const net of NETS) {
      const c = loadJson(net.eip155).value;
      const others = mini.filter((x) => x.chainId !== c.chainId);
      const norm = (s) => String(s).replace(/ /g, "").toUpperCase();
      check(!others.some((x) => norm(x.name) === norm(c.name)), `name "${c.name}" unused upstream`);
      check(!others.some((x) => norm(x.shortName) === norm(c.shortName)), `shortName "${c.shortName}" unused upstream`);
      const same = mini.find((x) => x.chainId === c.chainId);
      if (same) info(`chainId ${c.chainId} already listed upstream as "${same.name}"`);
      else ok(`chainId ${c.chainId} not yet taken upstream`);
    }
    for (const n of ["eip155-9800.json", "eip155-9801.json"]) {
      const st = await status(`${EL_RAW}/master/_data/chains/${n}`);
      info(`upstream _data/chains/${n}: ${st === 200 ? "present (this is an update)" : "absent (this is an addition)"}`);
    }
  } catch (e) {
    bad(`could not fetch ethereum-lists upstream files: ${e.message}`);
  }

  section("keplr-chain-registry: upstream validator version and current files");
  try {
    const pkg = await getJson(`${KEPLR_RAW}/package.json`);
    const v = (pkg.dependencies?.["@keplr-wallet/chain-validator"] || pkg.devDependencies?.["@keplr-wallet/chain-validator"] || "").replace(/^[v^~]/, "");
    if (v === KEPLR_VALIDATOR_VERSION) ok(`upstream pins @keplr-wallet/chain-validator ${v} (rules above match)`);
    else warn(`upstream pins @keplr-wallet/chain-validator ${v || "?"}, rules above were taken from ${KEPLR_VALIDATOR_VERSION}`);
    for (const net of NETS) {
      const st = await status(`${KEPLR_RAW}/cosmos/${basename(net.keplr)}`);
      info(`upstream cosmos/${basename(net.keplr)}: ${st === 200 ? "present (this is an update)" : "absent (this is an addition)"}`);
    }
  } catch (e) {
    bad(`could not fetch keplr-chain-registry upstream files: ${e.message}`);
  }

  section("cosmos/chain-registry: upstream JSON schemas and diff against master");
  try {
    const schemas = {
      "chain.json": await getJson(`${CR_RAW}/chain.schema.json`),
      "assetlist.json": await getJson(`${CR_RAW}/assetlist.schema.json`),
      "versions.json": await getJson(`${CR_RAW}/versions.schema.json`),
    };
    for (const net of NETS) {
      for (const [file, schema] of Object.entries(schemas)) {
        const p = join(net.crDir, file);
        const errs = schemaErrors(schema, loadJson(p).value);
        check(errs.length === 0, `${rel(p)}: valid against ${file.replace(".json", ".schema.json")}`, errs.join("; "));
        try {
          const up = await getJson(`${CR_RAW}/${net.crRel}/${file}`);
          const d = diffPaths(up, loadJson(p).value);
          info(`${net.crRel}/${file}: ${d.length} change(s) vs upstream master`);
          for (const line of d) console.log(`          ${line}`);
        } catch (e) {
          info(`${net.crRel}/${file}: not on upstream master (${e.message})`);
        }
      }
    }
    const up = await http(`${CR_RAW}/qorechain/images/qorechain.png`);
    if (up.ok) {
      const buf = Buffer.from(await up.arrayBuffer());
      const local = readFileSync(join(CR, "qorechain", "images", "qorechain.png"));
      info(`qorechain/images/qorechain.png: ${buf.equals(local) ? "identical to upstream master" : "differs from upstream master"}`);
    }
  } catch (e) {
    bad(`could not fetch chain-registry upstream files: ${e.message}`);
  }

  section("public source tags referenced by codebase");
  for (const net of NETS) {
    const cb = loadJson(join(net.crDir, "chain.json")).value.codebase;
    const repo = new URL(cb.git_repo).pathname.replace(/^\//, "");
    const tag = cb.tag || cb.recommended_version;
    const st = await status(`${GH_API}/repos/${repo}/git/ref/tags/${tag}`);
    if (st === 200) ok(`${net.key}: tag ${tag} exists in ${repo}`);
    else warn(`${net.key}: tag ${tag} not found in ${repo} (HTTP ${st}); testnet releases have no public source until mainnet runs them: submit the mainnet folder alone`);
  }
}

// ---------------------------------------------------------------------------
// 7. live chain checks

async function checkLive() {
  for (const net of NETS) {
    const cr = loadJson(join(net.crDir, "chain.json")).value;
    const al = loadJson(join(net.crDir, "assetlist.json")).value.assets[0];
    const vs = loadJson(join(net.crDir, "versions.json")).value.versions;
    const kp = loadJson(net.keplr).value;
    const el = loadJson(net.eip155).value;
    const rpc = cr.apis.rpc[0].address;
    const rest = cr.apis.rest[0].address;
    section(`live ${net.key}: ${cr.chain_id}`);
    try {
      // RPC: chain id, liveness
      const st = await getJson(`${rpc}/status`);
      check(st.result.node_info.network === cr.chain_id, `RPC ${rpc} /status network = ${cr.chain_id}`, st.result.node_info.network);
      const age = (Date.now() - Date.parse(st.result.sync_info.latest_block_time)) / 1000;
      check(!st.result.sync_info.catching_up && age < 300, `RPC is synced (height ${st.result.sync_info.latest_block_height}, last block ${Math.round(age)}s ago)`);
      info(`node consensus engine version ${st.result.node_info.version}`);

      // RPC websocket
      for (const w of cr.apis.wss || []) {
        const r = await wsCall(w.address, { jsonrpc: "2.0", id: 1, method: "health", params: {} });
        check(r.ok && r.data?.result !== undefined, `websocket ${w.address} answers health`, r.error);
      }

      // REST: same chain as RPC (node status hashes vs block header at that height)
      const ns = await getJson(`${rest}/cosmos/base/node/v1beta1/status`);
      const blk = await getJson(`${rpc}/block?height=${ns.height}`);
      const hdr = blk.result.block.header;
      check(b64ToHex(ns.validator_hash) === hdr.validators_hash && b64ToHex(ns.app_hash) === hdr.app_hash, `REST ${rest} serves ${cr.chain_id} (status hashes at height ${ns.height} equal the RPC block header)`);

      const bech = await getJson(`${rest}/cosmos/auth/v1beta1/bech32`);
      check(bech.bech32_prefix === cr.bech32_prefix && kp.bech32Config.bech32PrefixAccAddr === bech.bech32_prefix, `bech32 prefix on chain = "${bech.bech32_prefix}"`);

      const sp = (await getJson(`${rest}/cosmos/staking/v1beta1/params`)).params;
      check(sp.bond_denom === cr.staking.staking_tokens[0].denom && kp.stakeCurrency.coinMinimalDenom === sp.bond_denom, `staking bond denom on chain = ${sp.bond_denom}`);
      check(!cr.staking.lock_duration?.time || cr.staking.lock_duration.time === sp.unbonding_time, `unbonding time on chain = ${sp.unbonding_time}`);

      const cfg = await getJson(`${rest}/cosmos/base/node/v1beta1/config`);
      const m = /^([\d.]+)([a-z/]+)$/.exec(cfg.minimum_gas_price || "");
      const minGas = m ? Number(m[1]) : NaN;
      const ft = cr.fees.fee_tokens[0];
      check(m && m[2] === ft.denom && minGas === ft.fixed_min_gas_price, `node minimum gas price = ${minGas} ${m?.[2]} (registry ${ft.fixed_min_gas_price} ${ft.denom})`);
      check(kp.feeCurrencies[0].gasPriceStep.low >= minGas, `Keplr low gas price ${kp.feeCurrencies[0].gasPriceStep.low} >= node minimum ${minGas}`);

      const md = (await getJson(`${rest}/cosmos/bank/v1beta1/denoms_metadata/${al.base}`)).metadata;
      const dispOnChain = md.denom_units.find((u) => u.denom === md.display);
      const dispReg = al.denom_units.find((u) => u.denom === al.display);
      check(md.base === al.base && md.display === al.display && dispOnChain.exponent === dispReg.exponent, `bank metadata: ${md.base} -> ${md.display} exponent ${dispOnChain.exponent}`);
      check(md.symbol === al.symbol && md.name === al.name, `bank metadata symbol/name = ${md.symbol}/${md.name}`);

      // upgrade history and current version
      const props = (await getJson(`${rest}/cosmos/gov/v1/proposals?pagination.limit=200`)).proposals || [];
      const plans = props.flatMap((p) => (p.messages || []).filter((x) => x.plan).map((x) => ({ id: Number(p.id), status: p.status, name: x.plan.name, height: Number(x.plan.height) })));
      const applied = [];
      for (const name of [...new Set(plans.map((p) => p.name))]) {
        const h = Number((await getJson(`${rest}/cosmos/upgrade/v1beta1/applied_plan/${name}`)).height);
        if (h > 0) applied.push({ name, height: h });
      }
      applied.sort((a, b) => b.height - a.height);
      const latest = applied[0];
      check(latest && latest.name === cr.codebase.recommended_version, `latest applied upgrade = ${latest?.name} at height ${latest?.height}; recommended_version ${cr.codebase.recommended_version}`);
      for (const v of vs.filter((x) => x.height !== undefined)) {
        const a = applied.find((x) => x.name === v.name);
        const p = plans.find((x) => x.id === v.proposal);
        check(a && a.height === v.height && p && p.name === v.name && p.status === "PROPOSAL_STATUS_PASSED", `versions.json ${v.name}: proposal ${v.proposal}, applied at height ${v.height}`);
      }
      for (const p of plans.filter((x) => x.status === "PROPOSAL_STATUS_VOTING_PERIOD")) info(`upgrade ${p.name} at height ${p.height} is in voting (proposal ${p.id})`);

      // CosmWasm availability vs the Keplr feature flag
      const wp = (await getJson(`${rest}/cosmwasm/wasm/v1/codes/params`)).params;
      const codes = (await getJson(`${rest}/cosmwasm/wasm/v1/code?pagination.limit=1`)).code_infos || [];
      const wasmUsable = codes.length > 0 || wp.instantiate_default_permission !== "Nobody";
      check((kp.features || []).includes("cosmwasm") === wasmUsable, `Keplr "cosmwasm" feature ${wasmUsable ? "set" : "unset"} (codes stored: ${codes.length > 0 ? "yes" : "none"}, upload ${wp.code_upload_access.permission}, instantiate ${wp.instantiate_default_permission})`);

      // EVM
      const vm = (await getJson(`${rest}/cosmos/evm/vm/v1/params`)).params;
      check(vm.evm_denom === al.base, `EVM denom on chain = ${vm.evm_denom}`);
      info(`EVM extended denom ${vm.extended_denom_options?.extended_denom ?? "(none)"} (18-decimal view of ${vm.evm_denom})`);
      for (const u of el.rpc) {
        if (u.startsWith("http")) {
          const id = await jsonRpc(u, "eth_chainId", []);
          const nv = await jsonRpc(u, "net_version", []);
          check(parseInt(id, 16) === el.chainId && Number(nv) === el.networkId, `EVM ${u}: eth_chainId ${id}, net_version ${nv}`);
          const b = await jsonRpc(u, "eth_getBlockByNumber", ["latest", false]);
          const has1559 = (el.features || []).some((x) => x.name === "EIP1559");
          check(has1559 === (b.baseFeePerGas !== undefined), `EVM ${u}: EIP1559 feature ${has1559 ? "listed" : "not listed"}, baseFeePerGas ${b.baseFeePerGas ? BigInt(b.baseFeePerGas).toString() : "absent"} wei`);
          if (b.baseFeePerGas) check(BigInt(b.baseFeePerGas) >= BigInt(Math.round(minGas * 1e6)) * 10n ** 6n, `EVM base fee >= native minimum gas price x 10^12`);
        } else {
          const r = await wsCall(u, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
          check(r.ok && parseInt(r.data?.result, 16) === el.chainId, `EVM websocket ${u}: eth_chainId ${r.data?.result ?? r.error}`);
        }
      }
      for (const e of cr.apis["evm-http-jsonrpc"] || []) {
        if (!el.rpc.includes(e.address)) {
          const id = await jsonRpc(e.address, "eth_chainId", []);
          check(parseInt(id, 16) === el.chainId, `EVM ${e.address}: eth_chainId ${id}`);
        }
      }

      // SVM (not part of any registry schema, checked for the README)
      const svm = rpc.replace("//rpc", "//svm");
      try {
        const h = await jsonRpc(svm, "getHealth");
        const v = await jsonRpc(svm, "getVersion");
        check(h === "ok", `SVM ${svm}: getHealth ${h}, version ${v["solana-core"]}`);
      } catch (e) {
        warn(`SVM ${svm}: ${e.message}`);
      }

      // web pages
      for (const u of new Set([el.infoURL, cr.website, cr.codebase.git_repo, ...(el.explorers || []).map((x) => x.url)])) {
        const s = await status(u);
        check(s === 200, `${u} answers HTTP ${s}`);
      }
      for (const ex of cr.explorers || []) {
        const sample = { "${txHash}": "", "${accountAddress}": "", "${validatorAddress}": "", "${blockHeight}": String(ns.height) };
        const txs = await getJson(`${rest}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(`tx.height>${Number(ns.height) - 20000}`)}&order_by=ORDER_BY_DESC&limit=1`).catch(() => null);
        const tx = txs?.tx_responses?.[0];
        if (tx) sample["${txHash}"] = tx.txhash;
        const accts = await getJson(`${rest}/cosmos/auth/v1beta1/accounts?pagination.limit=1`).catch(() => null);
        const acct = accts?.accounts?.[0];
        sample["${accountAddress}"] = acct?.address || acct?.base_account?.address || acct?.base_vesting_account?.base_account?.address || "";
        const vals = await getJson(`${rest}/cosmos/staking/v1beta1/validators?pagination.limit=1`).catch(() => null);
        sample["${validatorAddress}"] = vals?.validators?.[0]?.operator_address || "";
        for (const k of ["tx_page", "account_page", "validator_page", "block_page"]) {
          if (!ex[k]) continue;
          let url = ex[k];
          for (const [ph, val] of Object.entries(sample)) url = url.replace(ph, val);
          if (/\$\{|\/$/.test(url)) {
            warn(`${k}: no sample value to test ${ex[k]}`);
            continue;
          }
          const s = await status(url);
          check(s === 200, `explorer ${k} ${url} answers HTTP ${s} (page renders client side; route reachability only)`);
        }
      }
      if (kp.explorers?.txPage) {
        info(`Keplr txPage ${kp.explorers.txPage} shares the explorer /tx/ route checked above`);
      }
      if ((el.explorers || []).some((x) => x.standard === "EIP3091")) {
        warn(`ethereum-lists explorer is marked EIP3091: the explorer must resolve EVM 0x tx hashes at /tx/<hash>`);
      }
    } catch (e) {
      bad(`live checks for ${net.key} aborted: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`registry validation, ${new Date().toISOString()}`);
  console.log(`root: registry/   live checks: ${OFFLINE ? "off" : "on"}   upstream: ${NO_UPSTREAM ? "off" : "on"}`);
  checkEthereumLists();
  checkKeplr();
  checkChainRegistry();
  checkConsistency();
  checkPolicy();
  if (!NO_UPSTREAM) await checkUpstream();
  if (!OFFLINE) await checkLive();
  console.log(`\n== summary: ${nPass} passed, ${nFail} failed, ${nWarn} warnings`);
  for (const f of failList) console.log(`  FAIL  ${f}`);
  for (const w of warnList) console.log(`  warn  ${w}`);
  process.exit(nFail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
