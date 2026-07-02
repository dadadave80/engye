#!/usr/bin/env bash
# Deploys the five ENGYE contracts (3 Vyper + SessionAccount.vy + IthacaAccount.sol)
# to Arc testnet and verifies each on testnet.arcscan.app (Blockscout) in the same run.
# Method proven in kite-ai/scripts/deploy.sh: forge script --verify --verifier blockscout.
#
# Usage: ./scripts/deploy.sh
# After: paste printed addresses into .env.local, then `bun scripts/delegate-roles.ts`.
set -euo pipefail

cd "$(dirname "$0")/../contracts"
set -a; source ../.env.local; set +a

VERIFIER_URL="https://testnet.arcscan.app/api/"

echo "=== ENGYE → Arc Testnet (chain 5042002) ==="
echo "rpc:      $RPC"
echo "deployer: BROKER ($BROKER_ADDRESS)"
echo

forge build

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --private-key "$BROKER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url "$VERIFIER_URL" \
  --slow

echo
echo "=== Done — every deploy must ship verified ==="
