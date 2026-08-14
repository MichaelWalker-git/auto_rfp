# Runbook — Brave Search API key (SSM)

The `search_service_pricing` AI tool (T3) looks up third-party service prices via the
Brave Search API. The API key is **not** managed by CDK — like the Bedrock key, it is
created manually in SSM Parameter Store, once per stage (dev / test / prod), in the
stage's AWS account and region (`us-east-1`).

- **Parameter name:** `/auto-rfp/brave-search/api-key` (same name in every stage; the
  Lambdas read it via the `BRAVE_SEARCH_API_KEY_SSM_PARAM` env var set in
  `api-orchestrator-stack.ts`)
- **Type:** `SecureString`
- **IAM:** no action needed — `commonLambdaRole` already has `ssm:GetParameter` on
  `arn:aws:ssm:*:*:parameter/auto-rfp/*`

## Steps

1. Get an API key from the Brave Search API dashboard (<https://api-dashboard.search.brave.com>).
   The free tier (~2,000 queries/month, 1 req/sec) is sufficient — the 30-day DynamoDB
   cache keeps volume well inside the quota. One key per stage is preferred so a leaked
   dev key can be rotated without touching prod.
2. Create the parameter in the stage's account:

   ```bash
   aws ssm put-parameter \
     --name /auto-rfp/brave-search/api-key \
     --type SecureString \
     --value '<BRAVE_API_KEY>' \
     --region us-east-1
   ```

3. Verify:

   ```bash
   aws ssm get-parameter \
     --name /auto-rfp/brave-search/api-key \
     --with-decryption \
     --region us-east-1 \
     --query Parameter.Value \
     --output text
   ```

## Rotation

Re-run `put-parameter` with `--overwrite`. Warm Lambda containers cache the key
in memory, so the old key remains in use until containers recycle (typically
minutes to a few hours) — keep the old key active in Brave until then.

## Failure behavior (ADR-15)

If the parameter is missing or the key is invalid, document generation still
completes: every `search_service_pricing` row degrades to
"vendor quote required (lookup unavailable)". Look for
`Failed to retrieve Brave Search API key from SSM` /
`search_service_pricing lookup unavailable` warnings in the generation worker's
CloudWatch logs.
