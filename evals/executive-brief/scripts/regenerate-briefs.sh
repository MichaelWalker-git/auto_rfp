#!/bin/bash
#
# Regenerates all 10 executive brief test cases by hitting the dev API.
# Triggers pricing generation, waits for completion, then exports updated briefs.
#
# Prerequisites:
#   - AWS credentials configured (for Cognito auth)
#   - jq installed
#
# Usage:
#   export AUTH_TOKEN="<your-cognito-id-token>"
#   ./regenerate-briefs.sh
#
# To get a token, run the app locally and copy from browser dev tools (Network > Authorization header)

set -euo pipefail

API_URL="https://dev0c9xj07.execute-api.us-east-1.amazonaws.com/Dev"
ORG_ID="9c0a5757-e2da-4e71-9490-01c558f7ffc3"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../overall/test-cases-rfps"

if [ -z "${AUTH_TOKEN:-}" ]; then
  echo "ERROR: AUTH_TOKEN not set. Export your Cognito ID token first."
  echo "  export AUTH_TOKEN=\"<token from browser dev tools>\""
  exit 1
fi

# Brief IDs for each test case (from existing test case JSONs)
declare -A BRIEF_IDS=(
  ["ms-iam-solution"]="012994da-38ca-46f7-8412-d404d3afcddb#80f93cb2-7ecb-49d0-9627-04f31d6d0c6c"
  ["data-mgmt-bi-platform"]="4d41817f-3e5c-43ac-a0d0-9f420ffbefe0#92e0e4fe-6677-45f2-b872-b092ffd454f0"
  ["san-mateo-beach-dashboard"]="3e8b5099-0c1a-4a78-a5e2-65719b2f7a81#d002d31a-c071-4a62-b045-eb3d1f2ecd9e"
  ["email-platform-replacement"]="5282701b-2dcf-485e-84d3-c90ce80c469b#f87974b0-82eb-419d-bc5f-f38471eeb8e5"
  ["grants-mgmt-system"]="959bd413-9679-46c1-80a8-78466a0b52ab#6c992081-756b-421a-8fb2-686ea6c0cc3d"
  ["erp-software-rfp-26-01"]="b94c25bb-91da-40a3-b29a-9a64144b01db#146bd550-b5a3-4de6-9f4f-4d515098bfc2"
  ["pm-software-services"]="63e3fbd8-f151-4d62-b157-8746a63f3f17#a10f87b1-1148-4544-ad7a-340d8ca35048"
  ["ecitation-system-sw"]="d1ae9e89-3992-494f-b76f-d39d23f37640#cf14f9a9-c129-495a-9893-ee61eadd690c"
  # These two don't have DB keys in the test case files — need to find them
  # ["airline-scheduling-solution"]="UNKNOWN"
  # ["legal-case-document-management-system"]="UNKNOWN"
)

echo "=== Regenerating Executive Brief Pricing Sections ==="
echo "API: $API_URL"
echo "Org: $ORG_ID"
echo ""

# Step 1: Trigger pricing generation for each brief
for name in "${!BRIEF_IDS[@]}"; do
  brief_id="${BRIEF_IDS[$name]}"
  echo "Triggering pricing for: $name"

  response=$(curl -s -X POST \
    "$API_URL/brief/generate-pricing?orgId=$ORG_ID" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"executiveBriefId\": \"$brief_id\"}")

  ok=$(echo "$response" | jq -r '.ok // false')
  if [ "$ok" = "true" ]; then
    echo "  ✓ Enqueued"
  else
    echo "  ✗ Failed: $(echo "$response" | jq -r '.error // "unknown"')"
  fi
done

echo ""
echo "Waiting 60 seconds for pricing generation to complete..."
sleep 60

# Step 2: Fetch updated briefs and save as test cases
echo ""
echo "=== Exporting Updated Briefs ==="

for name in "${!BRIEF_IDS[@]}"; do
  brief_id="${BRIEF_IDS[$name]}"
  project_id=$(echo "$brief_id" | cut -d'#' -f1)

  echo "Fetching brief for: $name"

  response=$(curl -s -X GET \
    "$API_URL/brief/by-project?orgId=$ORG_ID&projectId=$project_id" \
    -H "Authorization: Bearer $AUTH_TOKEN")

  ok=$(echo "$response" | jq -r '.ok // false')
  if [ "$ok" = "true" ]; then
    echo "$response" | jq '.brief' > "$OUTPUT_DIR/$name.json"

    # Check if pricing section exists now
    pricing_status=$(jq -r '.sections.pricing.status // "MISSING"' "$OUTPUT_DIR/$name.json")
    echo "  ✓ Saved ($pricing_status pricing)"
  else
    echo "  ✗ Failed to fetch: $(echo "$response" | jq -r '.error // "unknown"')"
  fi
done

echo ""
echo "=== Summary ==="
echo "Check pricing status:"
for name in "${!BRIEF_IDS[@]}"; do
  pricing=$(jq -r '.sections.pricing.status // "MISSING"' "$OUTPUT_DIR/$name.json" 2>/dev/null || echo "FILE_ERROR")
  echo "  $name: $pricing"
done

echo ""
echo "NOTE: airline-scheduling-solution and legal-case-document-management-system"
echo "need their brief IDs added to this script. Find them via:"
echo "  curl \"$API_URL/brief/by-project?orgId=$ORG_ID&projectId=<project-id>\" -H 'Authorization: Bearer <token>'"
