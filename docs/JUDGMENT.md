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
settled (`0x5f1ebe4c…`) through the deployed URL, not a local server. MiniPay
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
