#!/usr/bin/env bash
# Run RAG extraction eval: tests retrieval quality (embed → Pinecone → S3/DDB)
#
# Evaluates whether the retrieval pipeline returns relevant context
# for RFP-style queries — independent of LLM answer generation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"
EVAL_DIR="/tmp/promptfoo-rag-extraction"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Ensure nvm is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20

# Build the retrieval provider
echo "==> Building provider..."
cd "$SCRIPT_DIR"
npx esbuild retrieve.ts --bundle --platform=node --format=esm \
  --external:@pinecone-database/pinecone --external:@aws-sdk/* \
  --outfile=retrieve.mjs

# Ensure runtime directory exists
mkdir -p "$EVAL_DIR"
mkdir -p "$RESULTS_DIR"

# Sync files
echo "==> Syncing to $EVAL_DIR..."
cp "$SCRIPT_DIR/promptfooconfig.yaml" "$EVAL_DIR/promptfooconfig.yaml"
cp "$SCRIPT_DIR/retrieve.mjs" "$EVAL_DIR/retrieve.mjs"
cp "$EVALS_DIR/.env" "$EVAL_DIR/.env" 2>/dev/null || true

# Install dependencies if needed
if [ ! -d "$EVAL_DIR/node_modules" ]; then
  echo "==> Installing dependencies..."
  cat > "$EVAL_DIR/package.json" << 'PKGJSON'
{
  "name": "promptfoo-rag-extraction",
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

# Count tests
TEST_COUNT=$(grep -c "^ *- vars:" "$SCRIPT_DIR/promptfooconfig.yaml" || echo "?")
echo "==> Running RAG extraction eval ($TEST_COUNT test cases)..."
cd "$EVAL_DIR"
AWS_PROFILE=AdministratorAccess-039885961427 \
  npx promptfoo eval \
    --env-file .env \
    --no-cache \
    --no-table

# Copy results
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
