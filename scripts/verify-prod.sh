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
