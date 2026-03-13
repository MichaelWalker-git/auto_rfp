# AWS Partner Portal — IAM Setup for Opportunities CRUD

> The APN integration now uses the **Lambda execution role's IAM credentials** to call the
> AWS Partner Central Selling API. No per-organization credential configuration is needed.
>
> This document explains how the IAM permissions are provisioned via CDK and how to verify
> the setup.

---

## How It Works

The application's Lambda functions call the **AWS Partner Central Selling API** using the
`@aws-sdk/client-partnercentral-selling` SDK. The SDK automatically uses the Lambda
execution role's credentials (via the standard AWS credential chain), so there is **no need
to create separate IAM users or manage access keys**.

### IAM Permissions (Provisioned by CDK)

The shared Lambda role is granted the following permissions in
`packages/infra/api/api-orchestrator-stack.ts`:

```typescript
sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'PartnerCentralAccess',
    actions: [
      'partnercentral:CreateOpportunity',
      'partnercentral:GetOpportunity',
      'partnercentral:UpdateOpportunity',
      'partnercentral:ListOpportunities',
      'partnercentral:AssignOpportunity',
      'partnercentral:SubmitOpportunity',
    ],
    resources: ['*'],
  }),
);
```

These permissions are automatically deployed when you run `cdk deploy`.

---

## Prerequisites

- **AWS Partner Network (APN) membership** — your AWS account must be enrolled as an AWS Partner
- **Partner Central Selling API access** — enabled for your partner account
- The CDK stacks must be deployed (the IAM policy is added automatically)

---

## Verify the Setup

### 1. Check the Lambda role has the correct permissions

```bash
# Get the Lambda role name
ROLE_NAME=$(aws lambda get-function-configuration \
  --function-name auto-rfp-apn-retry-apn-registration-dev \
  --query "Role" --output text | awk -F/ '{print $NF}')

echo "Role: $ROLE_NAME"

# List attached policies
aws iam list-attached-role-policies --role-name "$ROLE_NAME"

# Check inline policies
aws iam list-role-policies --role-name "$ROLE_NAME"
```

### 2. Test the API from the Lambda role (optional)

```bash
# Invoke the list-registrations endpoint to verify connectivity
curl -H "Authorization: Bearer <YOUR_JWT>" \
  "https://<API_URL>/apn/registrations?orgId=<ORG_ID>"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Lambda Function                              │
│                                                                  │
│  PartnerCentralSellingClient({ region: 'us-east-1' })           │
│       │                                                          │
│       ▼  (uses Lambda execution role credentials automatically)  │
│  CreateOpportunityCommand / GetOpportunityCommand / etc.         │
│       │                                                          │
│       ▼                                                          │
│  AWS Partner Central Selling API                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Changes from Previous Architecture

| Before (per-org credentials) | After (Lambda IAM role) |
|---|---|
| Each org configured their own AWS access keys | Single Lambda role with IAM permissions |
| Credentials stored in Secrets Manager | No secrets needed — uses IAM role |
| `SaveApnCredentialsSchema` + credential endpoints | Removed — no configuration needed |
| `NOT_CONFIGURED` status for orgs without keys | Removed — always ready to register |
| Manual SigV4 signing via `@smithy/signature-v4` | AWS SDK handles signing automatically |
| `ApnCredentialsForm` in org settings | Removed from UI |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/apn/registration?orgId=&projectId=&oppId=` | Get registration status for an opportunity |
| `POST` | `/apn/retry-registration` | Retry a failed registration |
| `GET` | `/apn/registrations?orgId=` | List all registrations for an org |

> The `GET /apn/credentials` and `POST /apn/credentials` endpoints have been **removed**.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `AccessDeniedException` on Partner Central API | Lambda role missing `partnercentral-selling:*` permissions | Redeploy CDK stacks: `pnpm cdk deploy` |
| `PartnerNotFound` | AWS account not enrolled as an AWS Partner | Enroll at [partnercentral.awspartner.com](https://partnercentral.awspartner.com) |
| `ValidationException` | Invalid opportunity payload | Check the `lastError` field on the registration record |
| `RegionDisabledException` | API not available in selected region | Ensure `PARTNER_CENTRAL_REGION` env var is `us-east-1` (default) |
