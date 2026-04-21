#!/usr/bin/env bash
# Run faithfulness eval and save timestamped results.
#
# Usage:
#   ./run-eval.sh
#
# Requires:
#   - Node 20 (via nvm)
#   - AWS SSO session for AdministratorAccess-039885961427
#   - .env file in evals/ directory (parent)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"
EVAL_DIR="/tmp/promptfoo-faithfulness-eval"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Ensure nvm is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20

# Rebuild all providers from TypeScript source
echo "==> Rebuilding providers..."
cd "$SCRIPT_DIR"

ESBUILD_OPTS="--bundle --platform=node --format=esm --external:@pinecone-database/pinecone --external:@aws-sdk/*"

for provider in generate generate-develop generate-production generate-v4 generate-v5; do
  echo "    Building ${provider}.mjs..."
  npx esbuild "${provider}.ts" $ESBUILD_OPTS --outfile="${provider}.mjs"
done

# Ensure runtime directory exists
mkdir -p "$EVAL_DIR"
mkdir -p "$RESULTS_DIR"

# Sync files to isolated runtime directory
echo "==> Syncing to $EVAL_DIR..."
cp "$SCRIPT_DIR/promptfooconfig.yaml" "$EVAL_DIR/promptfooconfig.yaml"
cp "$SCRIPT_DIR/generate.mjs" "$EVAL_DIR/generate.mjs"
cp "$SCRIPT_DIR/generate-develop.mjs" "$EVAL_DIR/generate-develop.mjs"
cp "$SCRIPT_DIR/generate-production.mjs" "$EVAL_DIR/generate-production.mjs"
cp "$SCRIPT_DIR/generate-v4.mjs" "$EVAL_DIR/generate-v4.mjs"
cp "$SCRIPT_DIR/generate-v5.mjs" "$EVAL_DIR/generate-v5.mjs"
cp "$EVALS_DIR/.env" "$EVAL_DIR/.env" 2>/dev/null || true

# Install dependencies if node_modules missing
if [ ! -d "$EVAL_DIR/node_modules" ]; then
  echo "==> Installing dependencies..."
  cat > "$EVAL_DIR/package.json" << 'PKGJSON'
{
  "name": "promptfoo-faithfulness-eval",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.1026.0",
    "@aws-sdk/client-dynamodb": "^3.1026.0",
    "@aws-sdk/client-s3": "^3.1026.0",
    "@aws-sdk/lib-dynamodb": "^3.1026.0",
    "@pinecone-database/pinecone": "^7.1.0",
    "promptfoo": "^0.121.3"
  }
}
PKGJSON
  cd "$EVAL_DIR" && npm install
fi

# Run eval
echo "==> Running faithfulness eval (5 providers)..."
cd "$EVAL_DIR"
AWS_PROFILE=${AWS_PROFILE:-AdministratorAccess-039885961427} \
  npx promptfoo eval \
    --env-file .env \
    --no-cache \
    --no-table

# Copy outputPath results to timestamped file
if [ -f "$EVAL_DIR/results/latest.json" ]; then
  RESULT_FILE="$RESULTS_DIR/${TIMESTAMP}.json"
  cp "$EVAL_DIR/results/latest.json" "$RESULT_FILE"
  cp "$EVAL_DIR/results/latest.json" "$RESULTS_DIR/latest.json"

  echo ""
  echo "==> Results saved to:"
  echo "    $RESULT_FILE"
  echo "    $RESULTS_DIR/latest.json"
else
  echo "==> Warning: no results file found"
fi
