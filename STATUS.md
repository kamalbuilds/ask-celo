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
cd app

# 1. Locks the attribution tag. Google sign-in, paste back the short code.
TELEGRAM_HANDLE=@yourhandle npm run register

# 2. Send ~0.2 CELO to 0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77, then:
npm run go-live
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

**And do not compete on settlement count.** Measured on Jul 28: the facilitator
is at 155,721 settlements, three wallets produce 88% of recent activity, and the
leader alone runs ~12,900/day toward roughly 77,000 by the deadline. Our ceiling
is 500, one per prepaid credit — 0.65% of the leader. The reachable win is
settlements from a payer who is not the builder, which nobody else in the field
has. See `docs/JUDGMENT.md`.

## Two things waiting on a deploy

Committed and built, not yet live — Vercel's free tier caps at 100 deploys a
day and today hit it. Both ship on the next `vercel deploy --prod`:

- link previews (`og:` / `twitter:card`), so a shared URL is not a bare link
  in Telegram or on X

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
