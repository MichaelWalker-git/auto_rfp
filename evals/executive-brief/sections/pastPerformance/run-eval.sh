#!/usr/bin/env bash
# Run past performance faithfulness & answer relevancy eval.
#
# Usage:
#   ./run-eval.sh
#
# Requires:
#   - Node 20 (via nvm)
#   - AWS SSO session for AdministratorAccess-039885961427
#   - .env file in evals/ directory with:
#     PINECONE_API_KEY, PINECONE_INDEX, DOCUMENTS_BUCKET,
#     DB_TABLE_NAME, ORG_ID, BEDROCK_REGION

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVALS_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)/evals"
EVAL_DIR="/tmp/promptfoo-pastperf-eval"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Ensure nvm is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20

# Build provider from TypeScript source
echo "==> Building provider..."
cd "$SCRIPT_DIR"
npx esbuild generate.ts \
  --bundle \
  --platform=node \
  --format=esm \
  '--external:@pinecone-database/pinecone' \
  '--external:@aws-sdk/*' \
  --outfile=generate.mjs

# Ensure runtime directory exists
mkdir -p "$EVAL_DIR"
mkdir -p "$RESULTS_DIR"

# Sync files to isolated runtime directory
echo "==> Syncing to $EVAL_DIR..."
cp "$SCRIPT_DIR/promptfooconfig.yaml" "$EVAL_DIR/promptfooconfig.yaml"
cp "$SCRIPT_DIR/generate.mjs" "$EVAL_DIR/generate.mjs"

# Copy .env from evals root if it exists
for envpath in "$EVALS_ROOT/.env" "$SCRIPT_DIR/.env"; do
  if [ -f "$envpath" ]; then
    cp "$envpath" "$EVAL_DIR/.env"
    echo "    Using .env from $envpath"
    break
  fi
done

# Install dependencies if node_modules missing
if [ ! -d "$EVAL_DIR/node_modules" ]; then
  echo "==> Installing dependencies..."
  cat > "$EVAL_DIR/package.json" << 'PKGJSON'
{
  "name": "promptfoo-pastperf-eval",
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
echo "==> Running past performance eval..."
cd "$EVAL_DIR"
AWS_PROFILE=AdministratorAccess-039885961427 \
  npx promptfoo eval \
    --env-file .env \
    --no-cache \
    --no-table

# Copy results
if [ -f "$EVAL_DIR/results/latest.json" ]; then
  RESULT_FILE="$RESULTS_DIR/${TIMESTAMP}.json"
  mkdir -p "$RESULTS_DIR"
  cp "$EVAL_DIR/results/latest.json" "$RESULT_FILE"
  cp "$EVAL_DIR/results/latest.json" "$RESULTS_DIR/latest.json"

  echo ""
  echo "==> Results saved to:"
  echo "    $RESULT_FILE"
  echo "    $RESULTS_DIR/latest.json"
else
  echo "==> Warning: no results file found"
fi
