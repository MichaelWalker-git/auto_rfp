#!/usr/bin/env bash
# Run promptfoo eval and save timestamped results.
#
# Usage:
#   ./run-eval.sh
#
# Requires:
#   - Node 20 (via nvm)
#   - AWS SSO session for AdministratorAccess-039885961427
#   - .env file in evals/ directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_DIR="/tmp/promptfoo-eval"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Ensure nvm is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20

# Rebuild provider from TypeScript source
echo "==> Rebuilding retrieve.mjs..."
cd "$SCRIPT_DIR"
npx esbuild retrieve.ts \
  --bundle --platform=node --format=esm \
  --outfile=retrieve.mjs \
  --external:@pinecone-database/pinecone \
  --external:'@aws-sdk/*'

# Sync files to isolated runtime directory
echo "==> Syncing to $EVAL_DIR..."
cp "$SCRIPT_DIR/promptfooconfig.yaml" "$EVAL_DIR/promptfooconfig.yaml"
cp "$SCRIPT_DIR/retrieve.mjs" "$EVAL_DIR/retrieve.mjs"
cp "$SCRIPT_DIR/.env" "$EVAL_DIR/.env" 2>/dev/null || true

# Run eval
echo "==> Running eval..."
cd "$EVAL_DIR"
AWS_PROFILE=AdministratorAccess-039885961427 \
  npx promptfoo eval \
    --env-file .env \
    --no-cache \
    --no-table

# Get latest eval ID
EVAL_ID=$(AWS_PROFILE=AdministratorAccess-039885961427 npx promptfoo list -n 1 2>/dev/null | grep -oE 'eval-[^ ]+' | head -1 || echo "")

if [ -n "$EVAL_ID" ]; then
  # Export results
  RESULT_FILE="$RESULTS_DIR/${TIMESTAMP}.json"
  AWS_PROFILE=AdministratorAccess-039885961427 \
    npx promptfoo export eval "$EVAL_ID" -o "$RESULT_FILE"

  # Also save as latest for easy access
  cp "$RESULT_FILE" "$RESULTS_DIR/latest.json"

  echo ""
  echo "==> Results saved to:"
  echo "    $RESULT_FILE"
  echo "    $RESULTS_DIR/latest.json"
else
  echo "==> Warning: could not determine eval ID for export"
fi
