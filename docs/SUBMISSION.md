# Submission copy

## X post (required field `socialLink`)

The field enforces a host allowlist, so it must be a real published post on
x.com or twitter.com.

**Two drafts, both measured against the 280 limit, live in
[`aigora/x-post.md`](aigora/x-post.md).** They are the ones to post: the draft
that used to sit here was 750 characters, which is not a tweet, and a "draft"
that cannot be sent is a to-do wearing a costume.

The opening line is the hook worth keeping: MiniPay cannot make an x402
payment. It is the one fact in this hackathon that most people building on
Celo do not know, and it is checkable in their own docs.

## Project description (celobuilders submission)

Pay a cent a question, settled over x402 on Celo.

The problem: MiniPay implements neither `personal_sign` nor `eth_signTypedData`
(Celo docs, MiniPay constraints; upstream `celo-org/minipay#45` still open). An
x402 payment requires an EIP-3009 `transferWithAuthorization` signature, which is
typed data. So every MiniPay wallet is structurally unable to pay over x402
today, which is awkward for the chain positioning itself as agent payment rails.

The fix: MiniPay blocks *signing*, not *transacting*. Ask generates a session key
in the WebView, the user makes one plain `eth_sendTransaction` transfer into it
(no signature prompt, gas paid in USDC, carrying the ERC-8021 attribution tag),
and from then on the session key signs the EIP-3009 authorizations that x402
needs. Every paid question is a real facilitator settlement from a real person.

What it sells is live Celo chain data rather than an LLM proxy. The two answers
that matter to the people MiniPay serves:

- **What is my money worth?** Exchange rates between local currencies, read from
  Mento's on-chain oracle — the same one the chain settles against, so it is the
  rate a swap executes near rather than a counter's posted spread.
- **What will it cost to send it?** About $0.001 in network fees, measured live,
  against the World Bank's published 6.36% average for a $200 remittance
  (Remittance Prices Worldwide, Issue 54, Q3 2025).

Also current gas, Mento supply, facilitator status and block finality.

A cent-per-call LLM wrapper is worth less than the model's own free tier and
breaks when an upstream key dries up, which is a bad property for something
already paid for. These answers cannot be wrong about the chain, because they
are read from it at the moment they are asked.

## What is verifiable

Run `npm run verify` against the deployment, or check by hand:

```bash
# What it sells, what it costs, and how many settlements it can still make.
curl https://ask-celo.vercel.app/api/health

# The ERC-8004 agent document the on-chain identity points at.
curl https://ask-celo.vercel.app/agent.json

# The payment terms, readable without paying. The question has to be one the
# service can answer: anything else is refused free, before the paywall.
curl -si -X POST https://ask-celo.vercel.app/api/ask \
  -H 'content-type: application/json' -d '{"q":"dollar to shillings"}' \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d

# Never charged for a non-answer: 400 for an off-topic question, 200 for a
# question about the service itself, and neither settles anything.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://ask-celo.vercel.app/api/ask \
  -H 'content-type: application/json' -d '{"q":"who won the world cup"}'
```

That last decoded challenge carries an x402 **Bazaar discovery extension**: the
method, the JSON body shape, the `q` field and its length limit, and an example
answer. An agent that finds the endpoint can call it correctly without reading
any of this.


- **The service runs on Celo mainnet** (`eip155:42220`, real USDC, $0.01 a
  question) and every settlement it takes is a mainnet settlement. The rule is
  "Celo mainnet only" and this satisfies it.
  The signature-and-settlement mechanism was first proven on **Celo Sepolia**,
  through the deployed URL rather than a local server:
  `0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503`
  ([explorer](https://celo-sepolia.blockscout.com/tx/0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503)).
  Mainnet is configured identically and has taken 0 settlements so far, because
  the agent wallet is not yet registered with celobuilders.
- **Re-verified against the deployed site, in a MiniPay-shaped environment**
  where `personal_sign` and `eth_signTypedData_v4` both throw exactly as
  MiniPay does: the page auto-connects (`eth_requestAccounts`), shows no
  Connect button, the top-up calls `eth_sendTransaction` and nothing else, and
  a free answer renders in view at 360x640. Zero signing attempts throughout.
- MiniPay constraints verified together in a simulated WebView at 360x640:
  `eth_requestAccounts` + `eth_sendTransaction` only, zero signing attempts,
  fee currency set to the USDC *adapter*, legacy transaction shape, no Connect
  Wallet button.
- Payment ordering is safe: the middleware verifies, runs the handler, and
  cancels settlement if the handler fails. Confirmed on-chain when an upstream
  errored — the request failed and no funds moved.

## Agent contribution notes

Built with a coding agent throughout. The agent did the ecosystem research
(148k facilitator transactions scanned to see how the track was actually being
competed on, 30+ competitor repos read), found the MiniPay signing block across
four reference files plus the open upstream issue, and built a gated harness so
the core claim could be falsified before any UI existed. Notable catches: the
legacy `x402-express` package has no Celo network entry, a bare `price: "$0.01"`
compiles then throws at request time because Celo is missing from the default
asset table, Vercel's builder crashes on TypeScript 7, and `hono/vercel`'s
handler assumes a Web Request while the Node runtime supplies an
`IncomingMessage`.

The more useful work came after it shipped, from three questions asked
repeatedly: **which path has never actually run, do the duplicate copies agree,
and if I reintroduce the bug does the test fail?**

That found, among others: a free-refusal fix that charged nothing but rendered
`request failed (400)`, so the guidance never reached anyone; free answers
sitting behind a button disabled at a zero balance, unreachable by exactly the
people they existed for; `c.req.raw.clone()` hanging every POST for 30 seconds
on Vercel's runtime while the whole suite passed locally; a session key in
`sessionStorage` that would look correct in every test and destroy a user's
balance the moment a tab closed; and `npm run register` — the one command the
handoff document asks you to run — printing its usage block instead of
registering, because I had always run it with a subcommand by hand.

About sixty deliberate mutations were run against the suite, one invariant at a
time. Roughly a dozen survived, each a real gap: all three refund bounds
untested, a wrong USDC address that would fail every payment *after* a top-up
(Mento's StableTokenV2 implements EIP-2612, not EIP-3009), and receipt failures
reported as zero, which reads exactly like nothing having gone wrong. Two checks
turned out to pass while asserting nothing at all.
