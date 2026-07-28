# Where this stands

Live on Celo mainnet at **https://ask-celo.vercel.app**, taking real USDC.

Everything buildable is built, tested and deployed. Two inputs are outstanding,
both of which need you.

**A stranger with an empty wallet can now use it.** Questions about the service
("is this a scam", "can I get a refund") are answered free, before the paywall;
questions it cannot answer are refused free rather than charged; and the Ask
button is live at a zero balance, so those answers are actually reachable. A
paid question with no credit says what it costs instead of failing.

Verified on a 360x640 phone against the live site: tap an example chip, tap
Ask, and the answer is scrolled into view rather than left below the fold.
Touch targets are 44px, and the answer is announced to a screen reader.

## Do these two things

```bash
# From the repo root: this repo IS the app.

# 1. Locks the attribution tag. Google sign-in, paste back the short code.
TELEGRAM_HANDLE=@yourhandle npm run register

# 2. Send ~0.2 CELO to 0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77, then:
#    Two optional keys, both free and both worth a minute:
#      CELOSCAN_API_KEY  https://celoscan.io/myapikey
#        Proof of Ship asks for a *verified* contract. Without it the deploy
#        succeeds unverified, and fixing that means redeploying.
#      PINATA_JWT        https://pinata.cloud
#        Pins the 8004 metadata to IPFS so the CID is the integrity check.
#        Without it the identity still mints, pointing at /agent.json, which
#        is mutable after registration and 8004scan flags that.
CELOSCAN_API_KEY=<key> PINATA_JWT=<jwt> npm run go-live
```

`go-live` deploys the receipts contract, verifies its source on Celoscan, mints
the ERC-8004 identity, wires the production environment, redeploys and scores.
It refuses to start on an underfunded wallet rather than stranding a half-done
deploy.

**Corrected Jul 28.** I spent the day calling the tag urgent for both tracks.
Asked the organizers' API directly and it says otherwise, twice:

> the facilitator's relayer submits the settlement transaction itself, so it
> can't carry your tag — instead, settlements are attributed to the agent/payTo
> wallet in your submission and counted automatically.

So x402 settlements are not attributed by tag. They are attributed by the
agent wallet **on file with celobuilders**, and the API is explicit that it
counts "as soon as it's on file".

That is the part I had wrong in the other direction: we are **not registered at
all**. There is no `.celobuilders.json`, so no project, no tag, and no wallet on
file. `agentWalletAddress` sits in our local `.submission.json`, which they have
never seen.

**So `npm run register` is still the one blocking input, and it blocks both
tracks.** Until it runs, the leaderboard reads zero for us, because nobody has
told them the wallet is ours.

One thing I had wrong all day in the scary direction: for x402 settlements this
is **not** a decaying deadline. The live skill says plainly:

> attribution is retroactive across the whole hackathon window, but the
> leaderboard reads zero until the wallet is added

So settlements taken before registering are still counted once the wallet is on
file. What genuinely cannot be backfilled is the **tag inside top-up
transactions** (Track 1 revenue), because that data has to be in the calldata at
send time. Register before driving top-up volume; x402 volume is safe either
way.

It takes a minute: project name, public GitHub repo, personal Telegram handle,
and the wallet. Registration requires Google sign-in, and I checked the live
skill for any other path: there is none.

**Registering is not entering.** Publishing is a separate call, and the project
is not in the hackathon until it happens. The full sequence:

```bash
TELEGRAM_HANDLE=@you npm run register        # start, then claim with the code
node scripts/register.mjs draft              # fills every field, names what is missing
node scripts/register.mjs submit             # publishes the entry
```

`draft` is safe to run repeatedly and tells you exactly which fields are still
empty. Only `telegram` is required to register; the rest are required to
publish, and can be filled any time before Aug 3.

Everything a required field needs is drafted and checked in:

| Field | Where | Needs from you |
|---|---|---|
| `telegram` | `TELEGRAM_HANDLE=@you` | your handle |
| `socialLink` | `docs/aigora/x-post.md` | post one of two drafts, paste the URL |
| `erc8004Url` | `npm run go-live` | ~0.2 CELO for gas |
| `agentWalletAddress` | already in `.submission.json` | nothing |
| `celoNetwork` | already `celo-mainnet` | nothing |

Optional but worth it, both drafted:
`docs/aigora/registration.md` (every Aigora field, pre-validated) and
`docs/aigora/feedback-draft.md` (a real reproducible bug, which is Track 4's
whole scoring criterion).

**And do not compete on settlement count.** Measured three times on Jul 28:
148,118 settlements, then 155,721, then 158,958. That is 10,840 in one working
day, and three wallets produce 88% of it. Our ceiling is 500, one per prepaid
credit, which is well under one percent of what the leader adds daily.

Re-measuring mattered. The trend confirms the strategy rather than assuming it:
a count race here is not close, and pretending otherwise would waste the
remaining time.

The reachable win is settlements from a payer who is not the builder. Every
competitor repo read during research sells an API and then buys from itself,
so a single real third-party payment is a different claim from a large
self-dealt number. See `docs/JUDGMENT.md`.

## Everything is deployed

Vercel's free tier caps at 100 deploys a day and today hit it repeatedly, but
the cap message is unreliable: it printed the error and deployed anyway more
than once. `vercel ls` is the only honest answer, and `npm run verify` is the
only proof. Both are green.

Verified live on a 360x640 phone: tap an example chip, tap Ask, and a visitor
with an empty wallet gets a real answer. Link previews, the icon, 44px touch
targets and the screen-reader live region are all serving.

## What an agent sees

The service is callable by a machine without reading any prose:

- `GET /api/health` states what it sells, seven example questions, the price,
  the asset, and that unanswerable questions are free.
- The 402 challenge carries an x402 **Bazaar discovery extension** declaring
  the method, the JSON body shape, the `q` field and its 500-character limit,
  and an example answer. An agent that finds the endpoint can call it correctly
  on the first try.

Both verified against production, not just locally.

`/api/health` also reports remaining facilitator credits. Settlement stops dead
at zero and the symptom is a failing paywall, so the number is worth watching:
there are 500, which is 500 paid answers.

## When something goes wrong

Every path that takes or returns money now bounds its wait and says what it
knows rather than what it hopes:

- a paid request times out at 45s instead of hanging on "Thinking…" forever,
  and with the balance unchanged it says plainly that nothing was charged
- a refund that fails because facilitator credit ran out says so, and says the
  money is still in the session key and still yours
- a top-up rejected for insufficient funds says that, rather than "try again",
  which is advice that would fail identically forever
- a chain read that fails after payment returns 502 with "your payment was not
  taken", because the x402 middleware cancels settlement on any 4xx or 5xx

## Reproduced from a bare clone

Not "works on my machine". Cloned fresh from GitHub, `npm install`, then every
documented command:

| | |
|---|---|
| `npm test` | every suite and the contract tests, count printed by the run |
| `npm run verify` | production healthy on every path |
| `npm run score` | 34/100, with the blockers named |
| `npm run gates` | 3/5, the two failures naming the funding they need |
| `npm run fresh` | clones and follows the README as a stranger |

`gates` exits non-zero by design when a gate cannot run; the two that fail need
a funded wallet, and both say so rather than looking broken.

## How much of this is actually tested

Four suites plus the Solidity tests, and `npm test` prints the current count.
More useful than any count: **42 deliberate mutations across seven rounds,
every one now caught.**

Each round broke one real invariant and asked whether anything noticed. The
survivors clustered in two places, both of which no user reports until it is
too late:

- money leaving the system: all three refund bounds untested, a wrong USDC
  address (cUSD cannot settle over EIP-3009 at all), a session key in
  `sessionStorage` that would strand funds the moment a tab closed
- attribution being recorded: the receipt hook deletable without a failure,
  receipt failures reported as zero, the native-gas fallback removable

Three checks passed for the wrong reason and were caught only by mutating
rather than reading. One suite could not fail an async check at all.

## What is true right now

`npm run verify` reports it without editorialising:

| | |
|---|---|
| Network | `eip155:42220`, real Celo USDC, $0.01 per answer |
| Facilitator | 500 prepaid settlement credits |
| Receipts | **disabled** — no contract or tag, so sales earn no Track 1 credit |
| Bundle | **no tag** — every top-up would ship unattributed |

The service can take money. It cannot yet be credited for it.

## Commands

| | |
|---|---|
| `npm run check` | typecheck, build, all tests, production verify |
| `npm run verify` | is the deployed service actually selling? |
| `npm run fresh` | clone the public repo and follow the README as a stranger |
| `npm run score` | one number, both deadlines, biggest remaining lever |
| `npm test` | every suite, plus the Solidity contract tests |

## The wedge, in one paragraph

MiniPay implements neither `personal_sign` nor `eth_signTypedData`, so its
wallets cannot produce the EIP-3009 signature x402 settlement requires. Millions
of wallets are structurally locked out of Celo's own payment protocol, and the
upstream request is still open (`celo-org/minipay#45`). Ask bridges it with a
device-local session key: the user makes one ordinary transfer they can read,
and that key signs every payment afterwards. Proven on-chain on **Celo Sepolia**,
settlement `0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503`
([explorer](https://celo-sepolia.blockscout.com/tx/0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503)).
The service now sells on mainnet, where it has **0 settlements so far** — the
mechanism is proven, the demand is not.

Every competitor repo read during research sells an API and then buys from
itself. This is the only design in the field where the payer is somebody else.

## Reading

- `docs/TRY-IT.md` — how to pay, from a browser or a script
- `docs/GO-LIVE.md` — the mainnet runbook and what it costs
- `docs/JUDGMENT.md` — where this wins, how it loses, and the three questions
  that found nearly every bug
- `docs/RESEARCH.md` — the competitive scan and the measurement behind the wedge
- `docs/SUBMISSION.md` — submission copy and the X post draft
- `docs/SIDE-TRACKS.md` — Askbots and Aigora status
