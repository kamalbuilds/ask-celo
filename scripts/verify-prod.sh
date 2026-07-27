#!/usr/bin/env bash
# verify-prod.sh — is the deployed service actually selling anything right now?
#
#   npm run verify
#
# Checks the live deployment rather than local state: that it is on mainnet,
# that the 402 quotes real Celo USDC to our address, that the refund endpoint
# rejects malformed input, and that the facilitator still supports our network.
# Every claim in the docs should be reproducible from this output.
set -euo pipefail
echo "=== production health"
curl -s --max-time 20 https://ask-celo.vercel.app/api/health
echo
echo "=== 402 challenge terms"
curl -si --max-time 20 -X POST https://ask-celo.vercel.app/api/ask -H 'content-type: application/json' -d '{"q":"x"}' \
 | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d \
 | python3 -c "import json,sys;a=json.load(sys.stdin)['accepts'][0];print(' network',a['network']);print(' asset  ',a['asset']);print(' amount ',a['amount']);print(' payTo  ',a['payTo'])"
echo "=== refund endpoint guards bad input"
curl -s --max-time 20 -X POST https://ask-celo.vercel.app/api/refund -H 'content-type: application/json' -d '{}' -w ' [HTTP %{http_code}]\n'
echo "=== frontend chain"
curl -s https://ask-celo.vercel.app/ >/dev/null && echo " page serves"
echo "=== mainnet facilitator"
curl -s https://api.x402.celo.org/supported | python3 -c "import json,sys;print(' ', [k for k in json.load(sys.stdin)['kinds'] if k.get('x402Version')==2])"

echo "=== facilitator credits (settlement stops at zero)"
curl -s --max-time 20 "https://x402.celo.org/api/account?address=0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77" \
 | python3 -c "
import json,sys
d=json.load(sys.stdin)
n=d.get('balances',{}).get('mainnet',0)
print(f'  {n} mainnet credits (~{n} paid answers left)')
if n < 50:
    print('  ! LOW — top up at https://x402.celo.org or settlement starts failing')
    sys.exit(1)
"

echo "=== attribution receipts (Track 1 credit depends on these)"
curl -s --max-time 20 https://ask-celo.vercel.app/api/health | python3 -c "
import json,sys
r = json.load(sys.stdin).get('receipts', {})
if not r.get('enabled'):
    print('  disabled — no contract/tag yet, so sales earn no Track 1 credit')
else:
    a, ok, bad = r.get('attempted',0), r.get('recorded',0), r.get('failed',0)
    print(f'  {ok}/{a} recorded, {bad} failed')
    if bad and bad >= ok:
        print('  ! receipts are failing:', r.get('lastError','')[:90])
        sys.exit(1)
"

echo "=== the browser bundle carries the tag (server env is not enough)"
BUNDLE=$(curl -s --max-time 20 https://ask-celo.vercel.app/ | grep -oE 'src="/assets/[^"]+\.js"' | head -1 | sed 's|src="/assets/||;s|"||')
if [ -z "$BUNDLE" ]; then
  echo "  ! could not find the app bundle"
else
  if curl -s --max-time 20 "https://ask-celo.vercel.app/assets/$BUNDLE" | grep -qE 'celo_[a-z0-9]{8,32}'; then
    echo "  tag present in the shipped bundle — top-ups will be attributed"
  else
    echo "  no celo_ tag in the bundle — every top-up ships untagged and earns no Track 1 credit"
  fi
fi
