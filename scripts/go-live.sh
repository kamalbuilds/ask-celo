#!/usr/bin/env bash
# go-live.sh — everything that happens the moment the wallet has gas.
#
#   DEPLOYER_KEY=0x… CELOSCAN_API_KEY=… ./scripts/go-live.sh
#
# Deploys the receipts contract, verifies its source, mints the ERC-8004
# identity, wires the production deployment, and re-checks the result from
# chain. Refuses to start rather than half-finishing.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${DEPLOYER_KEY:?set DEPLOYER_KEY (the funded mainnet key)}"

ADDR=$(cast wallet address --private-key "$DEPLOYER_KEY")
BAL=$(cast balance --rpc-url https://forno.celo.org "$ADDR")
BAL_CELO=$(cast from-wei "$BAL")

echo "deployer: $ADDR"
echo "balance:  $BAL_CELO CELO"

# Deploy + mint is roughly 0.17 CELO at 200 gwei; require headroom so we do not
# strand halfway with a contract deployed and no identity minted.
if [ "$(echo "$BAL_CELO < 0.3" | bc -l)" = "1" ]; then
  echo
  echo "Not enough gas. Send ~0.5 CELO to $ADDR and re-run."
  echo "That covers the contract, the 8004 mint, and the first receipts."
  exit 1
fi

export X402_NETWORK=mainnet

echo
echo "=== 1/4  deploying AskReceipts"
./scripts/deploy.sh mainnet | tee /tmp/go-live-deploy.out
CONTRACT=$(grep -oE '^deployed: 0x[a-fA-F0-9]{40}' /tmp/go-live-deploy.out | awk '{print $2}')
[ -n "$CONTRACT" ] || { echo "could not parse deployed address" >&2; exit 1; }

echo
echo "=== 2/4  minting the ERC-8004 identity"
AGENT_PRIVATE_KEY="$DEPLOYER_KEY" \
AGENT_DOMAIN="${AGENT_DOMAIN:-https://ask-celo.vercel.app}" \
  node scripts/register-8004.mjs | tee /tmp/go-live-8004.out
AGENT_ID=$(grep -oE '^agentId: [0-9]+' /tmp/go-live-8004.out | awk '{print $2}')

echo
echo "=== 3/4  recording it"
python3 - "$CONTRACT" "${AGENT_ID:-}" <<'PY'
import json, sys, pathlib
contract, agent_id = sys.argv[1], sys.argv[2]
p = pathlib.Path(".submission.json")
s = json.loads(p.read_text()) if p.exists() else {}
s["contractAddress"] = contract
if agent_id:
    s["erc8004Url"] = f"https://8004scan.io/agents/celo/{agent_id}"
p.write_text(json.dumps(s, indent=2) + "\n")
print(f"contract {contract}")
print(f"8004     {s.get('erc8004Url','(not minted)')}")
PY

echo
echo "=== 4/4  pointing production at mainnet"
TAG=$(python3 -c "import json;print(json.load(open('.submission.json')).get('attributionTag',''))")
if [ -z "$TAG" ]; then
  echo "! No attributionTag yet — run 'npm run register' first."
  echo "  Receipts will be written but credited to nobody until it is set."
fi

for kv in "X402_NETWORK=mainnet" "RECEIPTS_CONTRACT=$CONTRACT" "RECORDER_PRIVATE_KEY=$DEPLOYER_KEY" "ATTRIBUTION_TAG=$TAG"; do
  K="${kv%%=*}"; V="${kv#*=}"
  [ -z "$V" ] && continue
  printf '%s' "$V" | vercel env add "$K" production --force >/dev/null 2>&1 && echo "  set $K"
done

vercel deploy --prod --yes >/dev/null 2>&1 && echo "  redeployed"

echo
echo "=== done"
npm run score
