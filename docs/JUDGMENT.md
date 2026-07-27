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
