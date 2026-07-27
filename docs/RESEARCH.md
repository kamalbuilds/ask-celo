# Celo Agentic Payments & DeFAI — Research Brief

Date: 2026-07-27. Deadline: **Aug 3, 09:00 GMT** (~6.5 days).
Second deadline: Proof of Ship July closes **tonight 23:59 GMT** (too late to place well, but registering
starts the August cycle and the project qualifies either way).

---

## 1. The four tracks, ranked by winnability

| Track | Prize | Win condition | Verdict |
|---|---|---|---|
| 1. Most Revenue | $2,000 / $1,000 | most tagged on-chain volume | **Biggest pot.** Volume is cheap to generate but "sybil review" by judges is explicit. Winnable only with real money movement. |
| 2. Most x402 Payments | $700 / $300 | raw count of facilitator settlements | **Being farmed hard.** See §2. Raw count alone is a losing race. |
| 3. Askbots | $500 (150/100/80/70/50) | highest-rated judge agent | Cheap side-quest, independent of the main build. |
| 4. Aigora feedback | $500 ($50 × 10) | top-10 most valuable feedback | Cheapest $ per hour in the whole hackathon. |

---

## 2. On-chain ground truth (measured, not assumed)

Facilitator wallet `0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48` (from `x402.celo.org/api/config`).

- **148,118 total transactions.** Nearly all are `transferWithAuthorization` settlements.
- Day-sampled top payees (300-tx samples, 2-day stride):

| Payee | Peak share of sample | Pattern |
|---|---|---|
| `0x3e19…2d63` | 151–239 / 300 | dominant most days; 9,081 txs, 18,266 token transfers |
| `0x53aa…c461` | 64–108 / 300 | steady second |
| `0x6bd5…1c43` | 177 / 300 (Jul 11–12) | early leader, faded |
| `0x2d5e…97c4` | 196 / 300 (Jul 19) | burst then gone |
| `0xf714…2158` | 95 / 300 (Jul 23) | burst |

- Volume is trivial: leader `0x3e19` has **977 settlements for $0.98 total** — $0.001 per call.
  This is **count farming**, not commerce. Payment counts are decoupled from value.
- Ramp: ~1 settlement/day on Jul 1 → thousands/day by Jul 27. Pure hockey-stick farming.

**Implication:** Track 2 as a raw-count race is already lost to whoever runs the biggest
self-call loop in the final 6 days. But the judges' stated FAQ says winners are selected on
"a combination of alignment with the ecosystem mission, consistent transactions, and
**real-world utility**", plus manual sybil review. A product where **settlements come from
real third-party humans** is the only defensible position in that track.

---

## 3. Competitive landscape (30+ repos read)

Everyone converged on the same three shapes:

1. **Sell an API behind x402, then buy from yourself.** metron, clean402, celo-sentinel,
   oraculo-x402, paycrawl, Agent402. Self-dealing loops. Count goes up, nobody is served.
2. **DeFi/FX agent.** bureau, yield-pilot, celobank-agent, remesaflow. Track 1 plays.
3. **Agent-to-agent marketplace/reputation.** relay-verdict, ledgerforge-celo, Metron.
   All agents-buying-from-agents; zero human demand.

Notable: **Agent402** (MikeyPetrillo, 7★) is a serious 500-tool x402 catalog with its own
leaderboard, but it is Base-first and cross-chain; Celo is one of ten chains.

**Nobody in the field has a human on the paying side.** Every buyer is a script.

---

## 4. The gap nobody has filled

MiniPay is 16M+ wallets and the whole reason Celo is pitched as agentic-payment rails.
But MiniPay **cannot do x402**:

> "No message signing — `personal_sign` and `eth_signTypedData` are not supported."
> — Celo docs, MiniPay constraints #4; repeated in `minipay-requirements.md`,
> `minipay-app-fit.md` (scored as a **hard block**, 0 points), `sdk-reference.md`.

x402 requires the buyer to sign an **EIP-3009 `transferWithAuthorization`** — typed data.
So the entire 16M-wallet distribution channel is structurally **locked out of x402**.
Confirmed open upstream: `celo-org/minipay#45` "support Permit2 approvals inside MiniPay
mini apps" — still open, and Permit2 is the same typed-data problem.

The one competitor who tried (**Duka**) worked around it by *not* using the facilitator:
it does a plain `eth_sendTransaction` ERC-20 transfer and calls the tx hash an
`X-PAYMENT` header. That is x402-shaped but **not a facilitator settlement**, so it counts
for nothing on the Track 2 leaderboard and gets none of x402's gasless/streaming properties.

Also from Celopedia's own MiniPay category map:

| Category | Apps live | Opportunity |
|---|---|---|
| **Pay AI as you go** | **0** | 🟢 High — "No apps yet. Pay-per-use AI tools with stablecoin micropayments are a strong fit" |

Proof of Ship's own "what to build" list names *"AI Agents with use cases for MiniPay
(including pay-as-you-go access to LLMs and image creation tools, as an alternative to
subscriptions)"*. Both programs are explicitly asking for the thing that is technically
impossible today.

---

## 5. The wedge: a session-key bridge that puts MiniPay users on x402

The MiniPay block is on **signing**, not on **transacting**. `eth_sendTransaction` works fine.
So:

1. The Mini App generates a **session key** in the WebView (viem local account, stored in
   `localStorage`, never leaves the device).
2. The user makes **one** plain ERC-20 transfer from MiniPay into that session address —
   `eth_sendTransaction`, no signature prompt, gas paid in USDC via `feeCurrency`. This is
   the only on-chain action the user ever takes, and it carries the **attribution tag**.
3. From then on, the session key signs **EIP-3009 authorizations** for every x402 call —
   which is exactly what the Celo facilitator wants. The facilitator sponsors the gas, so
   the session wallet never needs CELO.
4. Each paid action = one **real facilitator settlement**, from a real human, on Celo mainnet.

This converts a hard platform block into a working payment rail, and it is the only design
in the field where the money comes from outside the builder's own wallet.

### Why it wins across tracks
- **Track 2 (count):** every user action is a genuine facilitator settlement. Survives sybil
  review precisely because the payers are third parties, not a loop.
- **Track 1 (volume):** the top-up transfer is tagged with the assigned `celo_…` code.
  Real dollars, tagged.
- **Track 3/4:** independent side-quests, done separately for cheap $.
- **Proof of Ship:** MiniPay hook (booster), mainnet contract, consumer utility, and it
  lands in the one category with **zero** live apps.

### Risks to close during build
- Session-key UX must never show a seed phrase or an address; the whole point is that a
  non-crypto user sees "top up $1, then use the thing".
- Custody: the session key holds user funds. Keep balances tiny (default $1), add a
  one-tap sweep-back to the MiniPay address, and never send the key off-device.
- Attribution tags can be stripped by some smart-account paths — verify with `verifyTx`
  after the first tagged transfer (docs warn about this explicitly).
- Facilitator credits are metered (500 free mainnet, $0.001/settlement after). Budget it.

---

## 6. Verified integration facts (do not re-derive)

- Facilitator API: `https://api.x402.celo.org` (mainnet, `eip155:42220`),
  `https://api.x402.sepolia.celo.org` (testnet, `eip155:11142220`).
- Dashboard/API key: `https://x402.celo.org` → connect wallet → Create API key (`x402_…`).
  Human step, cannot be automated.
- Use **v2 scoped packages** `@x402/hono` | `@x402/express` + `@x402/core` + `@x402/evm`;
  buyer `@x402/fetch`. Legacy `x402-express` / `x402-fetch` have **no Celo** in their network
  enum. (metron burned a whole phase on this.)
- Never use a bare `price: "$0.01"` — Celo is not in the default-asset table, it 500s at
  request time. Always `{ amount: "10000", asset: USDC, extra: { name: "USDC", version: "2" } }`.
- USDC mainnet `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (6dp).
  USDT mainnet `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`, EIP-712 domain
  `name: "Tether USD", version: "1"`.
- **USDm / cUSD and all Mento locals do NOT work** with this facilitator — `StableTokenV2`
  implements EIP-2612 `permit` only, not EIP-3009.
- Fee abstraction: pay gas in USDC using the **adapter** `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B`,
  not the token address.
- ERC-8004 Identity Registry (Celo mainnet) `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`;
  Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Metadata `type` must be
  `https://eips.ethereum.org/EIPS/eip-8004#registration-v1`, `services` (not `endpoints`),
  each with `endpoint` (not `url`), and the `agentURI` must be `ipfs://` to avoid validator
  warnings.
- Attribution: register at celobuilders → response returns `attributionTag`, derived from the
  GitHub `owner/repo` slug and **locked at first save**. Only the assigned tag is credited.

---

## 7. Order of operations

1. Register on celobuilders **first** (project name + GitHub repo + Telegram) to lock the
   attribution tag. Untagged volume is worth zero, retroactively unrecoverable for Track 1.
2. Human gets the x402 API key from the dashboard.
3. Build + ship to mainnet, tagged, ERC-8004 registered.
4. Aigora + Askbots side-quests once the main build is live.
5. X post + publish submission before Aug 3, 09:00 GMT.
