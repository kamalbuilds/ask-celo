# Ask

Pay a cent a question. No subscription, no account, no card.

Built on Celo. Answers are paid for with x402 stablecoin micropayments that
settle on-chain in about a second.

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
   No signature prompt, gas paid in USDC, and the transfer carries our
   ERC-8021 attribution tag.
3. From then on the session key signs the EIP-3009 authorizations that x402
   settlement needs. The facilitator sponsors the gas.
4. Every question asked is a real on-chain settlement from a real person.
```

The user approves a single transfer they can read, and never sees a signature
prompt, a seed phrase, a gas fee, or the word CELO.

### Getting your money back

The session key holds your funds, so **Return unused credit** sweeps whatever is
left back to your MiniPay address. That path signs locally and talks straight to
the chain, so it keeps working even if this server is down. Top up small amounts;
it is a coin purse, not a bank account.

## Running it

```bash
npm install

# seller — the paid API
X402_NETWORK=testnet \
X402_API_KEY=x402_...            # from https://x402.celo.org (connect wallet → Create API key)
SELLER_PAY_TO=0xYourWallet \
LLM_API_KEY=sk-... \
npm run seller

# the Mini App
npm run dev
```

Testing inside MiniPay needs an https tunnel (`ngrok http 5173`) and a physical
Android device; MiniPay does not run in an emulator.

## Checking that it works

```bash
npm test     # attribution tag round-trip
npm run gates    # 5 gates against live systems
npm run score    # one number, both deadlines, biggest remaining lever
```

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
