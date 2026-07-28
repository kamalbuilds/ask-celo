# Going live on mainnet — what it costs and what it unlocks

Everything is built and proven on testnet. Mainnet needs gas, and that is the
only remaining gap.

## Fund this address

```
0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77
```

This is the agent wallet and the `payTo` for every x402 settlement. It already
holds the facilitator API key's credits (500 mainnet settlements prepaid).

Measured against Celo mainnet by estimating the real calls, not guessed:

| What | Gas | Cost at 202.5 gwei |
|---|---|---|
| Deploy `AskReceipts` | 330,598 | 0.067 CELO |
| Mint ERC-8004 identity | 203,424 | 0.041 CELO |
| **Total** | **534,022** | **0.108 CELO** (about $0.007) |

Send **~0.2 CELO** for headroom against a gas spike. The earlier figures here
were estimates that ran about 5x high, and `go-live.sh` asked for 0.5 on the
strength of them. Both are now the measured numbers, and the script refuses
below 0.15.

Plus a few dollars of **mainnet USDC** at the same address if you want the agent
to make real settlements itself rather than only receive them.

## Then this runs unattended

```bash
# From the repo root.
export X402_NETWORK=mainnet
export DEPLOYER_KEY=<key for the funded address>
export CELOSCAN_API_KEY=<for source verification>

npm run deploy -- mainnet        # deploys + verifies + re-reads state from chain
npm run register:8004            # mints the agent identity, prints the 8004scan URL
npm run score                    # confirms what moved
```

Then set these on the deployment so every paid answer writes a tagged receipt:

```
RECEIPTS_CONTRACT=<deployed address>
RECORDER_PRIVATE_KEY=<the recorder key>
ATTRIBUTION_TAG=<celo_… from celobuilders>
```

This part is not optional for Track 1. The x402 settlement **cannot** carry the
attribution tag, because the facilitator sends that transaction rather than us.
The receipt is the only transaction we control per sale, so it is what makes the
activity countable at all. Without it, real revenue is credited to nobody.

`deploy.sh` does not trust its own output: it re-reads the bytecode from the
chain and calls `recorder()` to confirm the constructor argument landed.

## What each deadline still needs

**Proof of Ship** (project page at talent.app)

- [x] Public GitHub repo, syncing
- [x] Live app URL, verified by meta tag
- [x] Description and category
- [ ] **Verified contract on Celo mainnet** ← the only gap, needs the gas above

**Hackathon** (Aug 3, 09:00 GMT)

| Field | Status |
|---|---|
| `agentWalletAddress` | `0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77` |
| `celoNetwork` | `celo-mainnet` |
| `erc8004Url` | needs the mint above |
| `telegram` | **needs your handle** |
| `socialLink` | needs a published X post |

Registration itself is one Google sign-in at `celobuilders.xyz` — that returns
the attribution tag. Note the split, which I had wrong for most of a day: x402
settlement attribution IS retroactive once the agent wallet is on file, so those
are safe. What cannot be backfilled is the tag inside top-up calldata. Track 1 only
credits tagged transactions, so untagged mainnet volume is lost permanently.

## Every step rehearsed

Nothing in this script runs for the first time when you run it. Each step was
exercised as far as money allows:

| Step | Rehearsed how |
|---|---|
| balance guard | refuses an underfunded wallet, exit 1, nothing spent |
| missing keys | both warnings fire together, before any gas moves |
| contract | compiles, 7 tests pass, deploy gas estimated at 330,598 against mainnet |
| 8004 metadata | validates; both a missing and an invalid PINATA_JWT fall back cleanly |
| 8004 mint | simulated against the real mainnet registry — would mint agentId 9746 |
| fallback URI | `/agent.json` serves 200 in production and matches what the mint registers |
| recording | run with a stub contract and agent id; readiness picked up `erc8004Url` and moved to 3/5 |
| env wiring | `vercel env add … --force` verified end to end with a probe variable, then removed |
| tag delivery | built with a tag set; it reaches the shipped browser bundle |

The two that cannot be rehearsed are the two that need money: the actual deploy
and the actual mint. Both are simulated first and refuse to send if the
simulation fails.

## Already proven, no further risk

- A session key signs EIP-3009 and the Celo facilitator settles it, on **Celo
  Sepolia** (testnet):
  `0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503`
  (through the deployed production URL, not a local server). The same code
  path serves mainnet; no mainnet settlement has happened yet.
- Payment ordering is safe: the middleware verifies, runs the handler, and
  cancels settlement if the handler fails. Confirmed on-chain when an upstream
  errored — the request failed and no funds moved.
- The attribution tag survives calldata concatenation, asserted by tests rather
  than assumed.

Switching to mainnet is a config change, not new code: `X402_NETWORK=mainnet`
selects the mainnet facilitator, USDC address, and registry in one place.

## The failure nobody would notice

Settlement is metered. Each paid answer spends one prepaid facilitator credit,
and the account starts with 500. At zero, `/settle` returns 402 and **every
purchase fails** — not loudly, and not in a way any test catches, because the
code is fine. The service simply stops being able to take money.

`npm run verify` now reports the balance and exits non-zero below 50 credits.
Top up with USDC at https://x402.celo.org.

At $0.01 per answer, 500 credits is 500 sales. That is a good problem to reach,
but it should not arrive as a surprise.
