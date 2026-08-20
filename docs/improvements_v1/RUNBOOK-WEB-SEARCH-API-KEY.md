# Runbook — Web-search API keys (SSM)

The `search_service_pricing` AI tool (T3) looks up third-party service prices via a
web-search provider. Since T15 the provider is swappable per stage via the
`WEB_SEARCH_PROVIDER` env var in `api-orchestrator-stack.ts`:

| Provider | `WEB_SEARCH_PROVIDER` | SSM parameter | Env var with the parameter name |
|---|---|---|---|
| **Tavily** (default) | `tavily` | `/auto-rfp/tavily/api-key` | `TAVILY_API_KEY_SSM_PARAM` |
| Brave | `brave` | `/auto-rfp/brave-search/api-key` | `BRAVE_SEARCH_API_KEY_SSM_PARAM` |

Tavily is the primary provider: Brave discontinued its free tier (now $5/1,000
requests with $5/month free credits, credit card required) and its API dashboard is
WAF-blocked from some regions, making key signup/rotation unreliable. Tavily offers
1,000 free credits/month, recurring, no card. Brave is kept as a fallback — set
`WEB_SEARCH_PROVIDER=brave` at deploy time on any stage that should keep using an
existing Brave key.

API keys are **not** managed by CDK — like the Bedrock key, each is created manually
in SSM Parameter Store, once per stage (dev / test / prod), in the stage's AWS
account and region (`us-east-1`).

- **Type:** `SecureString`
- **IAM:** no action needed — `commonLambdaRole` already has `ssm:GetParameter` on
  `arn:aws:ssm:*:*:parameter/auto-rfp/*`, which covers both parameters

## Steps

1. Get an API key for the stage's active provider. One key per stage is preferred so
   a leaked dev key can be rotated without touching prod.
   - **Tavily:** sign up at <https://app.tavily.com> (no credit card). The free tier
     (1,000 credits/month, recurring) is sufficient — the 30-day DynamoDB cache keeps
     volume well inside the quota.
   - **Brave:** Brave Search API dashboard (<https://api-dashboard.search.brave.com>).
     Paid tier ($5/1,000 requests, $5/month free credits, card required, 1 req/sec).
2. Create the parameter in the stage's account:

   ```bash
   # Tavily (default provider)
   aws ssm put-parameter \
     --name /auto-rfp/tavily/api-key \
     --type SecureString \
     --value '<TAVILY_API_KEY>' \
     --region us-east-1

   # Brave (only on stages deployed with WEB_SEARCH_PROVIDER=brave)
   aws ssm put-parameter \
     --name /auto-rfp/brave-search/api-key \
     --type SecureString \
     --value '<BRAVE_API_KEY>' \
     --region us-east-1
   ```

3. Verify:

   ```bash
   aws ssm get-parameter \
     --name /auto-rfp/tavily/api-key \
     --with-decryption \
     --region us-east-1 \
     --query Parameter.Value \
     --output text
   ```

## Rotation

Re-run `put-parameter` with `--overwrite`. Warm Lambda containers cache the key
in memory (per provider), so the old key remains in use until containers recycle
(typically minutes to a few hours) — keep the old key active with the provider
until then.

## Switching providers

Deploy with `WEB_SEARCH_PROVIDER=tavily|brave` (defaults to `tavily`). Make sure the
target provider's SSM parameter exists in the stage first; the other provider's
parameter can be left in place for a quick rollback.

## Failure behavior (ADR-15)

If the active provider's parameter is missing, the key is invalid, or
`WEB_SEARCH_PROVIDER` names an unknown provider, document generation still
completes: every `search_service_pricing` row degrades to
"vendor quote required (lookup unavailable)". Look for
`Failed to retrieve <provider> web search API key from SSM` /
`Unknown WEB_SEARCH_PROVIDER` /
`search_service_pricing lookup unavailable` warnings in the generation worker's
CloudWatch logs.
