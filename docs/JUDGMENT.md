# Judgment: does Ask survive scrutiny?

Applying the product-judgment lenses honestly, before submission rather than
after. Written to be read by someone looking for reasons to reject.

## Where it passes

**Specificity.** A competitor cannot publish this exact thing, because it rests
on a fact none of them noticed: MiniPay implements neither `personal_sign` nor
`eth_signTypedData`, so its wallets cannot produce the EIP-3009 signature x402
settlement requires. Every one of the 30+ competitor repos read during research
sells an API and then buys from itself. This is the only design in the field
where the payer is somebody other than the builder.

**Claim quality.** Nothing is claimed that is not on-chain. The kill test
settled (`0x5f1ebe4c…`) through the deployed URL, not a local server — on
**Celo Sepolia**. Four docs cited that hash as proof without naming the chain,
which a judge would fairly read as mainnet, because that is where the service
sells. Mainnet settlements: zero. MiniPay
compatibility was verified in a simulated WebView and the transcript is in the
commit message, not paraphrased.

**Proof path.** `npm run score` is one command producing one number with
recorded history. `npm test` is 17 assertions. Neither can be satisfied by
prose.

## Where it is weak, stated plainly

**Customer truth is the weakest link.** The honest version: a MiniPay user in
Lagos does not wake up wanting live Celo gas figures. The question set (gas,
Mento supply, facilitator status, block finality) is *developer* curiosity
served through a *consumer* channel. The payment rail is genuinely novel; the
thing being sold across it is not yet something anyone needs.

This is a real weakness and worth saying out loud rather than dressing up. What
makes it defensible is that the rail is the contribution: once a MiniPay wallet
can pay per request, the catalogue of what it pays for is a content problem, not
an architecture problem. But a judge would be right to push on it.

**Third-party payers is still zero on mainnet.** One settlement exists from a
wallet that is not the seller, on testnet. Until real people pay, "real demand"
is a claim about the future.

**Askbots queue is empty.** Registered and wired, but nothing to review yet.
That track may simply not be enterable in time, and that is supply-side, not
something more effort fixes.

## What would change the verdict

The single highest-value change is not more code. It is replacing the answer
catalogue with something a MiniPay user actually wants at a cent a call. FX
rates against local currency, remittance corridor costs, and airtime pricing
are all live-data questions where the answer is worth more than the fee, and all
three reuse the existing rail unchanged.

That is a content decision worth making before the Aug 3 deadline, not a
rewrite.

## How this loses

- A judge asks "who wants this answer?" and the honest reply is thin
- Zero mainnet third-party payers at judging time
- The rail is judged as infrastructure in a track that rewards volume

## How it wins

- It is the only entry where MiniPay users can pay over x402 at all
- The blocker it removes is documented in Celo's own docs and still open upstream
  (`celo-org/minipay#45`)
- Every claim is checkable on-chain in under a minute

## Adversarial pass on the money paths

Two findings, both from asking what an endpoint does *on my behalf* rather than
whether it works. Neither showed up in tests, because both passed every test
that existed. Tests confirm intent; they do not question it.

**Users could not withdraw.** `sweepBack()` sent an ordinary ERC-20 transfer,
but a session key holds USDC and never CELO, so it reverts with `gas required
exceeds allowance (0)`. Anyone who topped up and did not spend it all was stuck
permanently. Fixed by refunding through the same EIP-3009 path the payments use,
and proven by recovering 19.68 USDC from a wallet that could not afford a single
transaction (`0x9817455a…`).

**Strangers could spend our credits.** `/api/refund` settled any well-formed
authorization. It could never steal, since the payer signs it themselves, but it
was a free settlement service on a public URL funded by our prepaid facilitator
credits. Now bounded: sender and recipient must differ, the amount must be
positive and under $50, and it must move the key's exact full balance. All four
rejections verified against production.

### Checked and found sound

- **Replay.** EIP-3009 nonces are consumed in the token contract. Verified
  against the real nonce from our settled refund: `authorizationState` is
  `true`, so a repeat reverts before it reaches us.
- **Tampering.** Editing the amount after signing is rejected by the
  facilitator with `invalid_payment_amount`.
- **Paying for errors.** The middleware verifies, runs the handler, and cancels
  settlement if the handler throws or returns >= 400. Confirmed on-chain when an
  upstream failed: the request errored and no funds moved.

### Money claims are measured, not asserted

A category worth naming, because tests cannot catch it: a function can return
successfully, print exactly the string the developer intended, and still lie
about money. Four of these existed.

| Claim | Was | Now |
|---|---|---|
| "Ready." after top-up | printed after a fixed wait, regardless | only if the balance actually rose above its pre-transfer value |
| "Your credit was not spent" | printed on every ask failure | balance re-read; says "went wrong after payment" when it did |
| "Sent back to your wallet" | printed on a settlement hash | only after the balance reaches zero |
| "Nothing to return" | printed when settlement returned no hash | that now throws, because the money is still there |

The rule applied throughout: **if the UI says something about a user's money,
something must have measured it.** Where the measurement is unavailable, the
copy says so ("Still confirming", "Check your balance below") rather than
guessing in the user's favour.

## What actually found the bugs

Three questions did nearly all the work. None needed new information, only
looking at what was already there.

**"Which path has never actually run?"** Found the custody failure (users could
not withdraw), the credit drain (strangers could spend our facilitator
balance), the unattended go-live aborting before it could explain itself, the
register step burning a single-use OAuth code on a fumble, and credit
exhaustion stopping all sales silently. Every one passed the tests that existed,
because tests confirm what you meant rather than what will happen.

**"This value appears twice — do the copies agree?"** They rarely did. Two
answers quoted 21k and 65k gas for the same transfer (both wrong; the measured
figure is 85,794). The price was written out in seven places across three
files. The tests hardcoded the addresses they were testing. And the entire
service existed twice with an 80-line diff, which is why two fixes that day had
to be applied twice. The refinement: do not just check they agree, delete one of
them. Agreement you have to maintain is a bug waiting for the next edit.

**"If I reintroduce the bug, does the test fail?"** Three of five suites said
no. Each retyped the logic it was testing, so the FX bounds stayed green with
the 250x inversion restored, and both attribution builders could drop the tag
entirely without a single failure — while the tag is the whole mechanism by
which this work gets credited. Mutation testing found in twenty minutes what a
day of review had missed.

The common thread is that all three defeat confirmation. Reading code shows you
what it means; running the untested path, comparing the duplicate, and breaking
the thing on purpose show you what it does.

### The category tests cannot catch

Four user-facing messages asserted things about money that nothing had measured:
"Ready." after a top-up that had not arrived, "your credit was not spent" when
it might have been, "sent back to your wallet" before the balance emptied, and
"nothing to return" when a settlement had actually failed. The function returned
successfully and printed exactly the intended string in every case. Nothing
failed, so nothing could catch it. The rule now: if the UI says something about
a user's money, something must have measured it, and where measurement is
unavailable the copy says so rather than guessing in the user's favour.

## Track 2 by raw count is not winnable, measured

Re-scanned the facilitator late on day one of building (it has run since Jul 1).

| | |
|---|---|
| Total settlements | 155,721, up ~7,600 in about 4.5 hours |
| Rate | ~1,690 per hour across all builders |
| Top three wallets | **88%** of recent settlements |
| Leading wallet alone | ~536/hour, ~12,900/day |
| Projected leader by Aug 3 | ~77,000 settlements |
| Our ceiling | **500** — one per prepaid credit |

That is 0.65% of the leader, and topping up credits only buys more of a race
that is decided by whoever loops fastest. The leaders are paying themselves
$0.001 per call; the volume is real on-chain but the demand is not.

So the honest position: **do not compete on count.** The submission should lead
with the thing that is actually rare — settlements from a payer who is not the
builder — and let the count be whatever real usage produces. The judges' own
criteria say winners are chosen on "alignment with the ecosystem mission,
consistent transactions, and real-world utility", with manual sybil review. That
is the only frame in which this project is ahead rather than four orders of
magnitude behind.

It also means the marginal value of more engineering here is low. What moves the
outcome now is the attribution tag (so real payments count at all) and one real
user, not another test.


## The deploy cap lies both ways

`vercel deploy --prod` printed `Resource is limited - try again in 24 hours`
and **deployed anyway**. Thirteen changes I believed were queued had been live
for an hour, including one that hung every POST to the paid route for 30
minutes. I was reading the error message instead of the deployment list.

Later the same message meant what it said and nothing shipped.

So the message carries no information. The only way to know is:

```bash
vercel ls ask-celo | head -3          # is there a Ready deployment newer than the commit?
npm run verify                        # does the live service behave like the code?
```

Generalised: **a tool's own report of what it did is not evidence that it did
it.** The same failure produced a green test suite over a dead paywall, a
harness reporting 9 settlements on a chain nobody paid on, and a kill test
that had silently stopped testing settlement. In each case something claimed
success and the claim was never checked against the thing itself.


## I asked, and had the urgency backwards

I told the user all day that the attribution tag gated both tracks and decayed
by the hour. Then I asked the organizers' own endpoint:

```bash
curl -X POST https://celobuilders.xyz/hackathons/agentic-payments-defai/ask \
  -H 'content-type: application/json' \
  -d '{"question":"..."}'
```

> the facilitator's relayer submits the settlement transaction itself, so it
> can't carry your tag — instead, settlements are attributed to the agent/payTo
> wallet in your submission and counted automatically. Do NOT send separate
> tagged transactions to mirror settlements.

Track 2 needs no tag. Track 1 does. I had spent hours repeating an urgency I
had inferred from the rules rather than checked against them, and the endpoint
that answers it had been public the whole time.

Then I over-corrected. "Attributed by the payTo wallet in your submission"
reads like relief until you check whether the submission exists: there is no
`.celobuilders.json`, so we have never registered, and the wallet they would
attribute to has never been sent to them. Our `.submission.json` is a local
file. Registration is still the single blocking input, and it gates more than
I thought, not less.

Two wrong readings of the same rule in ten minutes, in opposite directions.
The fix for both was the same: check the state, not the wording.

The same lesson as the settlement hash that turned out to be testnet, and the
gas ask that was 5x the measured cost: **the claim I repeat most confidently is
the one I am least likely to re-check.** Ask the source, especially when the
source is one HTTP call away.
