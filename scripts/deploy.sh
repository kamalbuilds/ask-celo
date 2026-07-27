#!/usr/bin/env bash
# deploy.sh — put AskReceipts on Celo and verify the source.
#
#   DEPLOYER_KEY=0x… ./scripts/deploy.sh sepolia
#   DEPLOYER_KEY=0x… CELOSCAN_API_KEY=… ./scripts/deploy.sh mainnet
#
# Proof of Ship requires a *verified* contract on Celo mainnet, so
# verification is part of deploying, not an afterthought.
set -euo pipefail

NETWORK="${1:-sepolia}"

case "$NETWORK" in
  mainnet) RPC="https://forno.celo.org"; CHAIN_ID=42220; VERIFIER_URL="https://api.celoscan.io/api" ;;
  sepolia) RPC="https://forno.celo-sepolia.celo-testnet.org"; CHAIN_ID=11142220; VERIFIER_URL="https://api-sepolia.celoscan.io/api" ;;
  *) echo "usage: $0 [mainnet|sepolia]" >&2; exit 1 ;;
esac

: "${DEPLOYER_KEY:?set DEPLOYER_KEY to the deploying private key}"

# The recorder is the backend key that will call record(). Defaults to the
# deployer, which is fine for a single-operator service.
RECORDER="${RECORDER:-$(cast wallet address --private-key "$DEPLOYER_KEY")}"

echo "network:  $NETWORK ($CHAIN_ID)"
echo "deployer: $(cast wallet address --private-key "$DEPLOYER_KEY")"
echo "recorder: $RECORDER"

BALANCE=$(cast balance --rpc-url "$RPC" "$(cast wallet address --private-key "$DEPLOYER_KEY")")
echo "balance:  $(cast from-wei "$BALANCE") CELO"
if [ "$BALANCE" = "0" ]; then
  echo "deployer has no CELO for gas." >&2
  [ "$NETWORK" = "sepolia" ] && echo "faucet: https://faucet.celo.org/celo-sepolia" >&2
  exit 1
fi

forge create contracts/AskReceipts.sol:AskReceipts \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_KEY" \
  --constructor-args "$RECORDER" \
  --broadcast \
  ${CELOSCAN_API_KEY:+--verify --verifier etherscan --verifier-url "$VERIFIER_URL" --etherscan-api-key "$CELOSCAN_API_KEY"} \
  | tee /tmp/deploy.out

ADDRESS=$(grep -oE 'Deployed to: 0x[a-fA-F0-9]{40}' /tmp/deploy.out | awk '{print $3}')
[ -n "$ADDRESS" ] || { echo "could not parse deployed address" >&2; exit 1; }

echo
echo "deployed: $ADDRESS"
if [ "$NETWORK" = "mainnet" ]; then
  echo "celoscan: https://celoscan.io/address/$ADDRESS"
else
  echo "explorer: https://celo-sepolia.blockscout.com/address/$ADDRESS"
fi

# Confirm it is really live rather than trusting the deploy output.
CODE_SIZE=$(cast code --rpc-url "$RPC" "$ADDRESS" | wc -c | tr -d ' ')
echo "bytecode: $CODE_SIZE chars on chain"
[ "$CODE_SIZE" -gt 2 ] || { echo "no bytecode at address" >&2; exit 1; }

echo "recorder on chain: $(cast call --rpc-url "$RPC" "$ADDRESS" 'recorder()(address)')"

if [ -z "${CELOSCAN_API_KEY:-}" ]; then
  echo
  echo "note: source not verified (CELOSCAN_API_KEY unset)."
  echo "Proof of Ship requires a verified contract on mainnet."
fi
