# Submission copy

## X post (required field `socialLink`)

The field enforces a host allowlist, so it must be a real published post on
x.com. Draft:

> MiniPay has millions of wallets and cannot make a single x402 payment.
>
> It implements neither personal_sign nor eth_signTypedData, and x402 settlement
> needs an EIP-3009 signature. So the wallet that Celo built for payments is
> locked out of Celo's payment protocol.
>
> Built for @CeloDevs Agent Hackathon: Ask bridges it with a device-local
> session key. One ordinary transfer the user can read, then the session key
> signs every payment after. No seed phrase, no gas, no CELO in the UI.
>
> So a MiniPay user can now pay a cent to ask what their money is worth in
> shillings, or what sending it home actually costs. Both read live from the
> chain.
>
> Live on mainnet → https://ask-celo.vercel.app
> Registered onchain → [ERC-8004 link]
>
> https://ask-celo.vercel.app
>
> @celo

Keep the opening line as the hook. It is the one fact in this hackathon that
most people building on Celo do not know, and it is checkable in their own docs.

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
curl https://ask-celo.vercel.app/api/health     # price, network, receipt status
```


- **The service runs on Celo mainnet** (`eip155:42220`, real USDC, $0.01 a
  question) and every settlement it takes is a mainnet settlement. The rule is
  "Celo mainnet only" and this satisfies it.
  The signature-and-settlement mechanism was first proven on **Celo Sepolia**,
  through the deployed URL rather than a local server:
  `0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503`
  ([explorer](https://celo-sepolia.blockscout.com/tx/0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503)).
  Mainnet is configured identically and has taken 0 settlements so far, because
  the agent wallet is not yet registered with celobuilders.
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
