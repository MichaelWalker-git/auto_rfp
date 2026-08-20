# AWS Quota Increase Request — API Gateway "Integrations per API"

## Why this is needed

The dev HTTP API (`dev0c9xj07`, us-east-1, account `039885961427`) hit AWS's default limit of
**300 integrations per API** on 2026-08-20 while deploying the Team Definition feature.
CloudFormation failed with:

> `Maximum number of Integrations for this API has been reached. Please contact AWS if you need
> additional Integrations. (Service: ApiGatewayV2, Status Code: 429)`

Two limits are involved:

| Limit | Default | Status |
|---|---|---|
| Routes per HTTP API (`L-65B5C802`) | 300 | ✅ Already raised to **500** via Service Quotas (auto-approved 2026-08-20) |
| **Integrations per API** | 300 | ❌ NOT in Service Quotas and NOT raisable via API — needs a **support case** |

We are currently at **299/300 integrations** (two unused routes were removed to make the feature
fit). Any future new route — or any deploy that replaces a route, since CloudFormation creates
the new integration before deleting the old one — will fail until this limit is raised.

The Support API requires a Premium Support subscription, which this account does not have, so
the case must be filed manually in the console. **Basic support plans can still file service
limit increase cases** — it's free.

## How to file the request (step by step)

1. Sign in to the AWS Console on account **039885961427** (any user with support permissions).
2. Open **Support Center**: https://support.console.aws.amazon.com/support/home#/case/create
3. Choose **"Looking for service limit increases?"** (or case type **Service limit increase**).
   - If you only see "Account and billing" / "Technical", pick **Account and billing support** →
     it still routes limit-increase requests on basic plans.
4. Fill the form:
   - **Limit type:** `API Gateway`
   - **Region:** `US East (Northern Virginia)` (us-east-1)
   - **Limit:** `Integrations per API` (if not listed, choose the closest option — e.g.
     "Other" / "Routes per API" — and clarify in the description)
   - **New limit value:** `500`
5. Paste the **Subject** and **Use case description** below.
6. Contact method: Web (email). Submit.

Typical turnaround: hours to 1–2 business days. AWS sometimes asks a clarifying question —
the description below preempts the usual ones.

## Text to paste

### Subject

```
Increase "Integrations per API" limit for HTTP API dev0c9xj07 (us-east-1) to 500
```

### Use case description

```
Please increase the "Integrations per API" limit for API Gateway HTTP APIs (protocol type HTTP)
in us-east-1 for account 039885961427, specifically for API ID dev0c9xj07, from the default 300
to 500.

Context:
- Our HTTP API serves a multi-domain serverless application (AWS CDK, one AWS_PROXY Lambda
  integration per route).
- We have reached the default limit of 300 integrations. CloudFormation deployments that add
  routes now fail with: "Maximum number of Integrations for this API has been reached"
  (Service: ApiGatewayV2, Status Code: 429).
- The matching "Routes per HTTP API" quota (L-65B5C802) has already been approved at 500 via
  Service Quotas on 2026-08-20, so routes and integrations are now misaligned (500 vs 300).
  We are asking for the integrations limit to match it.
- Headroom above our steady-state count is also required because CloudFormation stack updates
  create replacement integrations before deleting removed ones, so updates transiently need
  more integrations than the final state.

If the same limit can be raised for our Test-stage API in the same account/region, please apply
it account-wide for HTTP APIs; otherwise dev0c9xj07 is the priority.

Happy to provide additional details. Thank you!
```

## After approval

1. Verify the deploy path works by re-running a normal deploy: `pnpm deploy:dev:api`.
2. Optionally restore the two routes that were removed on 2026-08-20 to free slots
   (handlers were kept in the codebase):
   - `GET /answer/low-confidence/{id}` — `packages/infra/api/routes/answer.routes.ts`
   - `POST /organization/upload-icon` — `packages/infra/api/routes/organization.routes.ts`
3. Longer term, consider splitting low-traffic domains onto a second HTTP API — the route count
   (299 and growing) will eventually outgrow any single-API limit.
