# @qorechain/qorex-interchain-kit

QoreX for [Interchain Kit](https://github.com/hyperweb-io/interchain-kit), with the QoreChain `signAndBroadcast` path. Interchain Kit is the actively maintained successor of cosmos-kit; prefer this package for new dApps (`@qorechain/qorex-cosmos-kit` covers cosmos-kit).

```bash
npm install @qorechain/qorex-interchain-kit @interchain-kit/core
```

```tsx
import { ChainProvider } from "@interchain-kit/react";
import { qorexWallet } from "@qorechain/qorex-interchain-kit";

<ChainProvider chains={chains} assetLists={assetLists} wallets={[qorexWallet]}>
  <App />
</ChainProvider>;
```

## Sending a transaction on QoreChain

QoreChain requires a hybrid secp256k1 + ML-DSA-87 (FIPS 204) signature. Only the wallet holds the ML-DSA-87 key, so on `qorechain-vladi` and `qorechain-diana` the dApp hands the messages to QoreX and QoreX builds, signs and broadcasts:

```ts
import { qorexSignAndBroadcast } from "@qorechain/qorex-interchain-kit";

const { txHash, code, height, shield } = await qorexSignAndBroadcast({
  chainId: "qorechain-vladi",
  messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: msgSendBytes }],
  memo: "",
});
```

`shield` is `"shielded"` once QoreX has confirmed the committed transaction carries the hybrid layer.

## Behaviour

| Call | Result |
|---|---|
| `connect`, `getAccount`, `getKey` | QoreX `enable` / `getKey`; `pubKey` and `address` converted from `number[]` to `Uint8Array` |
| `getOfflineSigner(chainId)` | direct signer for every preference (QoreX has no Amino signer) |
| signer `signDirect` on QoreChain | throws `QOREX_USE_SIGN_AND_BROADCAST` |
| signer `signDirect` on another chain id | forwarded to QoreX `signDirect`; the returned `signed` document is QoreX's |
| `signAmino` | throws `QOREX_AMINO_REFUSED`: refused by design, Amino JSON cannot carry the hybrid ML-DSA-87 signature |
| `signArbitrary`, `verifyArbitrary` | throw `QOREX_NOT_SUPPORTED_YET` (planned in a future QoreX version) |
| `sendTx` | throws `QOREX_NOT_SUPPORTED_YET`; broadcast through your RPC endpoint |

QoreX currently serves the QoreChain chain ids only; it rejects other chain ids with "QoreX: unsupported chain".

Planned: a future QoreX release will add the hybrid layer itself in `signDirect` when the SignDoc has none, and will declare the capability `signDirectAddsPqcLayer` (`QOREX_CAPABILITY_SIGN_DIRECT_ADDS_PQC_LAYER`). When it is declared, the signer forwards QoreChain SignDocs too. QoreX may then raise the gas limit and fee, so always broadcast the `signed` document the signer returns.

Errors are `QorexIntegrationError` with a stable `code`; test it with `isQorexIntegrationError(err, "QOREX_USE_SIGN_AND_BROADCAST")`.

Guides: <https://github.com/qorechain/qorex-integrations>.

Apache-2.0. Copyright 2026 QoreChain Association.
