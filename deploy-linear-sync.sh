#!/usr/bin/env bash
set -euo pipefail

# Deploy the Linear → RFP-tracking board sync stack to the DEV account.
# Uses the dev SSO profile so writes never hit prod.

echo "Loading dev SSO credentials..."
eval "$(aws configure export-credentials --profile AdministratorAccess-039885961427 --format env)"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "AWS account: $ACCOUNT"
if [ "$ACCOUNT" != "039885961427" ]; then
  echo "ERROR: not the dev account (expected 039885961427). Aborting."
  exit 1
fi

cd "$(dirname "$0")/packages/infra"
STAGE=Dev npx cdk deploy AutoRfp-RfpLinearSync-Dev --require-approval never
