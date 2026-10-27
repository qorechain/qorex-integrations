# QoreChain chain registry files

Ready-to-submit entries for the three public chain registries that wallets and
tools read to discover QoreChain mainnet (`qorechain-vladi`, EVM chain id 9801)
and testnet (`qorechain-diana`, EVM chain id 9800).

Every value was re-checked against the live chain on 27 October 2026 with
`scripts/validate.mjs` (see [Validation](#validation)).

| Folder | Upstream repository | Upstream target path | Status (27 Oct 2026) |
| --- | --- | --- | --- |
| `ethereum-lists/` | [ethereum-lists/chains](https://github.com/ethereum-lists/chains) | `_data/chains/eip155-9801.json`, `_data/chains/eip155-9800.json`, `_data/icons/qorechain.json` | Not listed yet. PR [#8935](https://github.com/ethereum-lists/chains/pull/8935) open, CI waiting for maintainer approval. Update needed (below). |
| `keplr-chain-registry/` | [chainapsis/keplr-chain-registry](https://github.com/chainapsis/keplr-chain-registry) | `cosmos/qorechain-vladi.json`, `cosmos/qorechain-diana.json`, `images/qorechain-vladi/chain.png`, `images/qorechain-diana/chain.png` | Not listed. PRs #1513 and #1515 closed unmerged in July. Blocked (below). |
| `chain-registry/` | [cosmos/chain-registry](https://github.com/cosmos/chain-registry) | `qorechain/`, `testnets/qorechaintestnet/` | Listed since PR [#7781](https://github.com/cosmos/chain-registry/pull/7781) merged on 6 July 2026. This folder is an update. |

## Chain facts used (verified live)

| Fact | Mainnet | Testnet |
| --- | --- | --- |
| Chain id | `qorechain-vladi` | `qorechain-diana` |
| EVM chain id | 9801 (`0x2649`) | 9800 (`0x2648`) |
| RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| RPC websocket | `wss://rpc.qore.host/websocket` | `wss://rpc-testnet.qore.host/websocket` |
| REST | `https://api.qore.host` | `https://api-testnet.qore.host` |
| EVM JSON-RPC | `https://evm.qore.host` | `https://evm-testnet.qore.host`, `wss://evm-ws-testnet.qore.host` |
| SVM JSON-RPC (not part of any registry schema) | `https://svm.qore.host` | `https://svm-testnet.qore.host` |
| Bech32 prefix | `qor` | `qor` |
| Coin type (SLIP-44) | 118 | 118 |
| Native denom | `uqor`, display `qor`, exponent 6, symbol QOR | same |
| EVM decimals | 18 (`aqor` = `uqor` x 10^12) | same |
| Minimum gas price | 0.1 uqor | 0.1 uqor |
| EVM base fee | 100 gwei (= 0.1 uqor) | same |
| Unbonding time | 1814400s (21 days) | same |
| Software version | v3.2.4 (upgrade proposal 13, height 3742566) | v3.2.6 (upgrade proposal 28, height 8970638) |
| Explorer | `https://explore.qore.network` | none with a per-network URL |

Pending at the time of writing: mainnet upgrade v3.2.5 (proposal 14, height
3906833) is in its voting period.

## ethereum-lists

Files: `ethereum-lists/eip155-9801.json`, `ethereum-lists/eip155-9800.json`,
`ethereum-lists/icons/qorechain.json`.

History:

- PR #8479 (mainnet and testnet, opened 3 July) was closed unmerged by the
  stale bot on 21 September. Its one failing check was Prettier.
- PR #8541 (mainnet only, opened 25 July) was closed unmerged by the stale bot
  on 7 October, also on Prettier.
- PR [#8935](https://github.com/ethereum-lists/chains/pull/8935) (branch
  `liviuepure:add-qorechain`, head `156775b`) was opened on 27 October with the
  Prettier fix. Its workflows (build, prettier, schema, actionlint) show
  "action required": a maintainer must approve them before they run.

Changes in this folder compared with the files in PR #8935:

- `explorers[0].standard` is `none` instead of `EIP3091`. EIP-3091 requires
  `/tx/<hash>` to resolve EVM transaction hashes; the explorer's `/tx/` route
  resolves native transaction hashes and returns "Transaction not found" for an
  EVM `0x` hash. Switch back to `EIP3091` once the explorer resolves EVM
  hashes on `/tx/`.
- `features: [{ "name": "EIP155" }, { "name": "EIP1559" }]` added on both
  networks (the EVM returns `baseFeePerGas` on both).
- Testnet `rpc` also lists `wss://evm-ws-testnet.qore.host` (answers
  `eth_chainId` = `0x2648`). Mainnet has no public EVM websocket.
- The icon file is unchanged. Its IPFS CID
  `QmaQomwQgzSnciuXfQXv5GReSYVXjjdzdb8LTpQC9xphw5` is the CIDv0 of the
  512x512 QoreChain icon PNG (computed locally by the validator). It must stay
  pinned on a node reachable with `ipfs get`.

Submit (update the open PR):

1. In the fork `liviuepure/chains`, check out branch `add-qorechain` and merge
   the current `ethereum-lists/chains` `master` into it.
2. Copy `ethereum-lists/eip155-9801.json` and `ethereum-lists/eip155-9800.json`
   to `_data/chains/`, and `ethereum-lists/icons/qorechain.json` to
   `_data/icons/qorechain.json`.
3. Run `npx prettier --check '_data/*/*.json'` and `./gradlew run`.
4. Commit with the message `QoreChain: explorer standard none, EIP155/EIP1559
   features, testnet websocket RPC` and push. PR #8935 picks up the commit.
5. Leave a comment on #8935 asking a maintainer to approve the workflow runs,
   and re-request a review once CI is green.

If #8935 gets closed, open a new PR from the same branch with:

- Title: `Add QoreChain (9801) and QoreChain Testnet (9800)`
- Body:

  ```
  Adds QoreChain mainnet and testnet.

  - `_data/chains/eip155-9801.json`: QoreChain mainnet (RPC https://evm.qore.host, explorer https://explore.qore.network)
  - `_data/chains/eip155-9800.json`: QoreChain Testnet Diana (RPC https://evm-testnet.qore.host, websocket wss://evm-ws-testnet.qore.host)
  - `_data/icons/qorechain.json`: 512x512 PNG icon on IPFS

  Both RPCs are public and return their chain id from `eth_chainId` (0x2649 / 0x2648) and `net_version` (9801 / 9800).
  The native currency is QOR with 18 decimals on the EVM. The shortNames `qor` and `qor-testnet` are not used by any existing chain.
  `npx prettier --check '_data/*/*.json'` passes.
  ```

## Keplr

Files: `keplr-chain-registry/cosmos/qorechain-vladi.json`,
`keplr-chain-registry/cosmos/qorechain-diana.json`, and the 256x256 PNGs at
`keplr-chain-registry/images/qorechain-vladi/chain.png` and
`keplr-chain-registry/images/qorechain-diana/chain.png` (downscaled from the
512x512 QoreChain icon).

Status: blocked. PRs #1513 and #1515 (3 July) were closed unmerged. The
maintainers' reason: QoreChain native transactions need a hybrid ML-DSA-87
plus secp256k1 signature, which Keplr and the standard CosmJS signing flow do
not produce, and the registry cannot fix that. Do not resubmit until Keplr can
produce that signature for QoreChain accounts.

Changes compared with the July files:

- Mainnet no longer sets `features: ["cosmwasm"]`. On mainnet no CosmWasm code
  is stored and both upload and instantiate permissions are `Nobody`, so there
  are no CW20 tokens for Keplr to show. The testnet keeps the flag (contracts
  are stored and instantiation is open).
- The chain images were regenerated from the current 512x512 icon.

No `evm` block is set: accounts use coin type 118 keys, and Keplr derives EVM
addresses for coin type 60 / `eth-address-gen` chains, which would not match
QoreChain's unified account mapping.

Submit (when unblocked):

1. Fork `chainapsis/keplr-chain-registry` (existing fork:
   `liviuepure/keplr-chain-registry`), sync with `main`, create branch
   `add-qorechain`.
2. Copy `keplr-chain-registry/cosmos/*.json` to `cosmos/` and
   `keplr-chain-registry/images/*` to `images/`.
3. Run `yarn install`, then `yarn validate cosmos/qorechain-vladi.json` and
   `yarn validate cosmos/qorechain-diana.json`.
4. Open a PR against `main`:
   - Title: `Add QoreChain (qorechain-vladi) and QoreChain Testnet (qorechain-diana)`
   - Body:

     ```
     Adds QoreChain mainnet and testnet.

     - `cosmos/qorechain-vladi.json` and `images/qorechain-vladi/chain.png` (256x256): mainnet
     - `cosmos/qorechain-diana.json` and `images/qorechain-diana/chain.png` (256x256): testnet, `isTestnet: true`

     Mainnet RPC https://rpc.qore.host, REST https://api.qore.host.
     Testnet RPC https://rpc-testnet.qore.host, REST https://api-testnet.qore.host.
     Bech32 prefix `qor`, coin type 118, native QOR (`uqor`, 6 decimals), minimum gas price 0.1 uqor.
     Explorer (mainnet): https://explore.qore.network/tx/{txHash}. No coinGeckoId.
     ```

## cosmos/chain-registry

Files: `chain-registry/qorechain/{chain.json,assetlist.json,versions.json,images/qorechain.png}`
and `chain-registry/testnets/qorechaintestnet/{chain.json,assetlist.json,versions.json}`.

The testnet has no `images/` folder on purpose: in the review of #7781 the
maintainers asked for the testnet chain and asset to use `image_sync` to the
mainnet logo (plus a `test-mintage` trace on the testnet asset) instead of a
duplicate image. The mainnet image is byte-identical to the one already
upstream.

Changes compared with what is on upstream `master` (from the July PR):

- `codebase`: `recommended_version` / `compatible_versions` move from v3.1.82
  to v3.2.4 (mainnet, plus `tag: v3.2.4`) and v3.2.6 (testnet).
- `codebase.consensus` is omitted. The schema's `type` enum lists upstream engine
  names and nothing else, and the field is optional. If you want it kept, add it
  back at submission time with version `0.38.26` (what both networks report
  now; the upstream file still says `0.38.19`).
- `versions.json` (both networks): the July `v3.1.82` entry is kept without its
  `consensus` block, and every governance upgrade since then is added with its
  proposal id and applied height. The CI step that compares `codebase` with the
  matching `versions.json` entry fails without these entries.
- `description` (chain and asset) and `keywords` rewritten to factual wording.
- `staking.lock_duration.time`: `1814400s` (the on-chain unbonding time).
- Mainnet explorer gains `validator_page` and `block_page`.
- `denom_units[0].aliases: ["microqor"]` mirrors the on-chain bank metadata.

Before submitting:

- Publish tag `v3.2.6` (and `v3.2.5`) in `qorechain/qorechain-core`; the
  testnet `recommended_version` points at it and the public repository has no
  such tag yet. Otherwise submit the mainnet folder alone.
- If mainnet upgrade v3.2.5 (proposal 14) has been applied by then, bump the
  mainnet `codebase` and add the v3.2.5 entry to `versions.json` first
  (`node scripts/validate.mjs` fails until both match the chain).

Submit:

1. In the fork `qorechain/cosmos-chain-registry`, sync `master` with
   `cosmos/chain-registry` and create branch `qorechain-v3.2.4`.
2. Copy `chain-registry/qorechain/*` to `qorechain/` and
   `chain-registry/testnets/qorechaintestnet/*` to
   `testnets/qorechaintestnet/` (overwrite).
3. Run `npx @chain-registry/cli@1.47.0 validate --registryDir . --logLevel error`
   and `cd .github/workflows/utility && node validate_data.mjs`.
4. Open a PR against `master`:
   - Title: `QoreChain: update mainnet to v3.2.4 and testnet to v3.2.6`
   - Body:

     ```
     Updates QoreChain (`qorechain`) and QoreChain Testnet (`qorechaintestnet`).

     - codebase: mainnet v3.2.4 (governance proposal 13, height 3742566); testnet v3.2.6 (proposal 28, height 8970638)
     - versions.json: governance upgrades since v3.1.82 with proposal ids and heights
     - staking.lock_duration: 1814400s (on-chain unbonding time)
     - explorers: validator and block pages for https://explore.qore.network
     - description and keywords reworded; asset denom alias from the on-chain bank metadata

     All endpoints answer for their chain id (RPC /status, REST node status, EVM eth_chainId).
     ```

## Validation

```
node registry/scripts/validate.mjs                 # everything
node registry/scripts/validate.mjs --offline       # skip live endpoint checks
node registry/scripts/validate.mjs --no-upstream   # skip fetching upstream rules
```

Node 22 or newer, no dependencies. The script:

- validates each file against the upstream JSON schemas fetched at run time
  (`tools/schema/chainSchema.json` of ethereum-lists; `chain.schema.json`,
  `assetlist.schema.json`, `versions.schema.json` of chain-registry);
- applies the upstream CI rules that are not in a schema: the ethereum-lists
  processor checks and Prettier layout, name/shortName/chainId uniqueness
  against the published chain list, the Keplr chain-validator and
  `src/validate.ts` / `src/index.ts` rules (256x256 PNG images, features,
  testnet flags), and the chain-registry `validate_data.mjs` checks (fee and
  staking tokens in the assetlist, image size and squareness, `image_sync`,
  traces, codebase versus `versions.json`);
- checks that the three registries agree with each other;
- re-reads every value from the live chain: chain ids over RPC and REST,
  websockets, bech32 prefix, bond denom, unbonding time, minimum gas price,
  bank metadata, applied upgrades and proposal ids, CosmWasm permissions, EVM
  chain id, base fee and websocket, SVM health, and the explorer routes;
- scans the published files for wording that must not appear in this public
  repository.

Result on 27 October 2026: 297 checks passed, 0 failed, 1 warning (tag `v3.2.6`
is not yet published in `qorechain/qorechain-core`).
