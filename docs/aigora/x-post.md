# The X post (required as `socialLink`)

`socialLink` must be a public X/Twitter post about the submission, on
`x.com` or `twitter.com`. It is required to publish, and it is the one link most
people will actually follow. The link preview card is live, so posting the URL
renders the 1200x630 card rather than a bare string.

Pick one. Both are under 280 characters.

## Option A: leads with the problem

```
MiniPay has millions of wallets and can't make a single x402 payment.

It implements neither personal_sign nor eth_signTypedData, and x402 needs an
EIP-3009 sig.

So I built the bridge: one ordinary transfer, then a local key signs every
payment after.

https://ask-celo.vercel.app
```

## Option B: leads with the product

```
Ask: a cent a question, on Celo.

"What's a dollar worth in shillings?" Read live from Mento's on-chain oracle.

No sign-up, no card, no CELO for gas. Questions it can't answer are refused
before payment, so you're never charged for a non-answer.

https://ask-celo.vercel.app
```

## After posting

```bash
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("app/.submission.json")
s = json.loads(p.read_text())
s["socialLink"] = "https://x.com/kamalbuilds/status/PASTE_ID_HERE"
p.write_text(json.dumps(s, indent=2) + "\n")
PY
cd app && node scripts/register.mjs draft   # re-checks what is still missing
```

The host must be `x.com` or `twitter.com`; the submission check enforces it, so
a shortened or cross-posted link will be rejected before you submit rather than
during.
