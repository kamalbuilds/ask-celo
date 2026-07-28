# Ask

> **Status:** live on Celo mainnet. Two things left, both needing you — see
> [STATUS.md](STATUS.md).

Pay a cent a question. No subscription, no account, no card.

You are never charged for a non-answer: a question outside what the service can
read from the chain is refused before payment, and questions about the service
itself are answered free.

```
"dollar to shillings"     ->  1 USD = <live> KES, from Mento's on-chain oracle.
                              The rate the chain settles at, so a swap executes
                              near it rather than at a counter's posted spread.

"cost to send money home"  ->  Sending $200 in stablecoins on Celo costs about
                              $0.001 in network fees. The World Bank's Remittance
                              Prices Worldwide (Issue 54) puts the global average
                              for a $200 remittance at 6.36%.
```

The rate is deliberately not pinned here. It was written as `139 KES` and was
`129` a week later, which is the whole argument for reading it live rather than
publishing it.

Two questions with real stakes for the people MiniPay serves: what is my money
worth, and what will it cost to send it. Also exchange rates across five local
currencies, live stablecoin supply, and block finality. Each answer is read
from the chain at the moment you ask, so none of it can be stale.

Payment is x402 stablecoin micropayments, settled on-chain in about a second.

## The problem this solves

MiniPay is a stablecoin wallet with millions of users, and Celo is positioned as
the payment rail for AI agents. But the two cannot currently meet: **MiniPay
implements neither `personal_sign` nor `eth_signTypedData`**, and an x402 payment
requires an EIP-3009 `transferWithAuthorization` signature, which is typed data.

So every MiniPay wallet is structurally locked out of x402 today. Celo's own
docs list this as a hard constraint, and the upstream request for typed-data
support ([`celo-org/minipay#45`](https://github.com/celo-org/minipay/issues/45))
is still open.

## How it works

MiniPay blocks *signing*, not *transacting*. `eth_sendTransaction` works fine.

```
1. The app generates a session key in the browser. It never leaves the device.
2. The user makes ONE ordinary transfer from MiniPay into that session key.
   No signature prompt, and gas paid in USDC. The transfer carries our
   ERC-8021 attribution tag once one is set (`ATTRIBUTION_TAG`); until then
   it is an ordinary untagged transfer, and `npm run verify` says so.
3. From then on the session key signs the EIP-3009 authorizations that x402
   settlement needs. The facilitator sponsors the gas.
4. Every question asked is a real on-chain settlement from a real person.
```

The user approves a single transfer they can read, and never sees a signature
prompt, a seed phrase, a gas fee, or the word CELO.

### Getting your money back

**Return unused credit** sends whatever is left back to your own wallet.

Worth being precise about how, because the obvious approach does not work: the
session key holds USDC and never CELO, so it cannot pay for an ordinary
transfer. It reverts with `gas required exceeds allowance (0)`. The refund
therefore uses the same EIP-3009 path as the payments — your browser signs
"move my balance to my address", and the facilitator submits it and pays the
gas.

That means the refund does depend on this service relaying the request, since
settlement needs a metering key that must not live in a browser. The signature
is yours and the destination is your own wallet, so nobody else can move your
funds, but a refund is not possible while the service is down. Top up small
amounts; it is a coin purse, not a bank account.

## Try it

Live on Celo mainnet: **https://ask-celo.vercel.app** — $0.01 per question,
payable from a browser wallet or a script. See [docs/TRY-IT.md](docs/TRY-IT.md)
for both paths, including how to read the payment terms without paying.

## Running it

```bash
npm install
cp .env.example .env.local        # then fill it in, see the notes below
```

`.env.local` needs three values:

| Variable | Where it comes from |
|---|---|
| `X402_API_KEY` | run `npm run x402:key` — signs a message with a throwaway wallet, no gas |
| `SELLER_PAY_TO` | the wallet that receives payments |
| `X402_NETWORK` | `testnet` to start, `mainnet` when you mean it |

Then, in two terminals:

```bash
npm run seller                    # the paid API
npm run dev                       # the Mini App
```

The service refuses to start if `SELLER_PAY_TO` or `X402_API_KEY` is missing,
rather than booting and failing at the first sale.

Testing inside MiniPay needs an https tunnel (`ngrok http 5173`) and a physical
Android device; MiniPay does not run in an emulator.

## Checking that it works

```bash
npm test          # every suite, plus the Solidity contract tests
npm run check     # typecheck, build, tests, and verify the deployed service
npm run verify    # is the live service actually selling right now?
npm run score     # one number, the remaining blockers, the biggest lever
npm run fresh     # clone this repo and follow this README as a stranger
```

`npm run score` runs the gates with the deployed state loaded. Running
`npm run gates` on its own reports fewer passes, because it has no
`SELLER_PAY_TO` or seller URL to check against; that is a missing argument,
not a failing system.

`gates.mjs` is the honest one. G3 is a kill test: it makes a session key sign a
real EIP-3009 authorization, has the facilitator settle it, then re-fetches the
transaction hash from the chain and asserts it succeeded, because a receipt is
only the seller's claim until the chain agrees.

## Notes for anyone building on Celo x402

Things that cost time to discover:

- Use the **v2 scoped packages** (`@x402/hono`, `@x402/core`, `@x402/evm`,
  `@x402/fetch`). The legacy `x402-express` / `x402-fetch` line has no Celo entry
  in its network enum and simply rejects the network at request time.
- **Never use a bare `price: "$0.01"`.** It typechecks, then throws at request
  time because Celo is absent from the packages' default-asset table. Pass the
  explicit `{ amount, asset, extra: { name, version } }` object. Amounts are
  strings in base units, so `$0.01` is `"10000"`.
- **USDm, cUSD and the Mento local stablecoins do not work** with the hosted
  facilitator. `StableTokenV2` implements EIP-2612 `permit`, not EIP-3009. Use
  USDC or USDT.
- For `feeCurrency`, pass the **adapter** address, not the token address.
- USDT's EIP-712 domain is `name: "Tether USD", version: "1"` — its `version()`
  method reverts.
- The facilitator's dashboard root serves an SPA, so a naive health check gets
  HTTP 200 with an HTML shell. Assert a JSON content type or you get a false green.

## Licence

MIT
