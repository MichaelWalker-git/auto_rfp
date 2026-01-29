# AutoRFP Deployment Guide

This document covers deployment processes, environment configuration, and productionization guidelines for AutoRFP.

## Table of Contents

- [CI/CD Overview](#cicd-overview)
- [Current Environment](#current-environment)
- [Prerequisites](#prerequisites)
- [Deployment Process](#deployment-process)
- [Environment Configuration](#environment-configuration)
- [Multi-Environment Setup](#multi-environment-setup)
- [CDK Nag Security Compliance](#cdk-nag-security-compliance)
- [Productionization Checklist](#productionization-checklist)
- [Troubleshooting](#troubleshooting)

---

## CI/CD Overview

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **Unit Tests** | PR, push to develop/production | Runs tests for shared, web-app, infrastructure |
| **E2E Tests** | PR, push to develop/production | Playwright tests with 3 parallel shards |
| **Deploy Infrastructure** | Push to develop (infra changes), manual | Deploys CDK stacks to AWS |
| **Lighthouse** | PR to develop | Performance audits |
| **Release** | Manual | Promotes develop → production |

### Deployment Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DEVELOPMENT FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Feature Branch ──PR──► develop ──────────────────► production         │
│         │                   │                            │              │
│         ▼                   ▼                            ▼              │
│   ┌──────────┐        ┌──────────┐                ┌──────────┐         │
│   │Unit Tests│        │Unit Tests│                │  Release │         │
│   │E2E Tests │        │E2E Tests │                │ Workflow │         │
│   └──────────┘        │Deploy Inf│                └──────────┘         │
│                       │(auto)    │                                      │
│                       └──────────┘                                      │
│                             │                                           │
│                             ▼                                           │
│                    ┌────────────────┐     ┌────────────────┐           │
│                    │  Dev Backend   │     │  Dev Frontend  │           │
│                    │  (CDK Stacks)  │     │   (Amplify)    │           │
│                    └────────────────┘     └────────────────┘           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### What Gets Deployed Automatically

| Component | Auto-Deploy Trigger | Environment |
|-----------|---------------------|-------------|
| Frontend (Next.js) | Push to `develop` | AWS Amplify (Dev) |
| Backend (Lambda/API) | Push to `develop` (infra changes) | AWS CDK (Dev) |
| Frontend (Next.js) | Push to `production` | AWS Amplify (Prod) |
| Backend (Lambda/API) | Manual release workflow | AWS CDK (Prod) |

### GitHub Secrets Required

| Secret | Purpose | Required For |
|--------|---------|--------------|
| `E2E_TEST_EMAIL` | Test user for E2E | E2E Tests |
| `E2E_TEST_PASSWORD` | Test user password | E2E Tests |
| `NEXT_PUBLIC_BASE_API_URL` | API Gateway URL | Build/E2E |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito Pool ID | Build/E2E |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito Client ID | Build/E2E |
| `SAM_GOV_API_KEY` | SAM.gov API access | Infrastructure Deploy |
| `PINECONE_API_KEY` | Pinecone vector DB API key | Infrastructure Deploy |
| `PINECONE_INDEX` | Pinecone index name | Infrastructure Deploy |

### GitHub Variables Required (for Infrastructure Deploy)

| Variable | Purpose |
|----------|---------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for OIDC authentication |

---

## Current Environment

| Property | Value |
|----------|-------|
| **Stage** | Dev |
| **AWS Account** | 018222125196 |
| **AWS Region** | us-east-1 |
| **AWS Profile** | michael-primary |
| **Frontend Branch** | develop |
| **Amplify URL** | https://d53rbfmpyaoju.execute-api.us-east-1.amazonaws.com |

### Deployed Stacks

| Stack Name | Purpose |
|------------|---------|
| `AutoRfp-Network` | VPC and security groups |
| `AutoRfp-Auth-Dev` | Cognito User Pool |
| `AutoRfp-Storage-Dev` | S3 buckets |
| `AutoRfp-DynamoDatabase-Dev` | DynamoDB table |
| `AutoRfp-DocumentPipeline-Dev` | Document processing Step Functions |
| `AutoRfp-QuestionsPipeline-Dev` | Question extraction Step Functions |
| `AutoRfp-API-Dev` | API Gateway + Lambda functions |
| `AmplifyFeStack-Dev` | Frontend hosting |

---

## Prerequisites

### Required Tools

```bash
# Node.js 20+
node --version  # Should be v20.x or higher

# AWS CLI v2
aws --version

# AWS CDK CLI
npm install -g aws-cdk

# pnpm (for web-app and shared)
npm install -g pnpm
```

### AWS Configuration

```bash
# Configure AWS profile
aws configure --profile michael-primary

# Verify credentials
aws sts get-caller-identity --profile michael-primary
```

### Required Secrets

| Secret | Location | Purpose |
|--------|----------|---------|
| `SAM_GOV_API_KEY` | Environment variable | SAM.gov API access |
| `auto-rfp/github-token` | AWS Secrets Manager | Amplify GitHub access |
| `LINEAR_API_KEY` | AWS Secrets Manager | Linear integration |

---

## Deployment Process

### Full Deployment (All Components)

```bash
# 1. Build shared package
cd shared && pnpm install && pnpm build

# 2. Build web app (optional - Amplify builds automatically)
cd ../web-app && pnpm install && pnpm build

# 3. Deploy infrastructure
cd ../infrastructure
npm install

# Set required environment variables
export SAM_GOV_API_KEY="your-sam-gov-api-key"

# Deploy all stacks
npm run deploy
# Or explicitly:
cdk deploy --all --profile michael-primary --require-approval never
```

### Deploy Specific Stacks

```bash
cd infrastructure

# Deploy only API stack
cdk deploy AutoRfp-API-Dev --profile michael-primary

# Deploy only auth stack
cdk deploy AutoRfp-Auth-Dev --profile michael-primary

# View changes before deploying
cdk diff --profile michael-primary
```

### Frontend Deployment

The frontend deploys automatically via AWS Amplify when changes are pushed to the `develop` branch.

**Manual trigger:**
1. Go to AWS Amplify Console
2. Select `auto_rfp` application
3. Click "Redeploy this version" or push to `develop` branch

---

## Environment Configuration

### Infrastructure Environment Variables

Set these before running `cdk deploy`:

```bash
# Required
export SAM_GOV_API_KEY="SAM-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Optional - Override defaults
export CDK_DEFAULT_ACCOUNT="018222125196"
export CDK_DEFAULT_REGION="us-east-1"
```

### Lambda Environment Variables

These are automatically set by CDK:

| Variable | Description |
|----------|-------------|
| `STAGE` | Environment name (Dev/Prod) |
| `DB_TABLE_NAME` | DynamoDB table name |
| `DOCUMENTS_BUCKET` | S3 bucket for documents |
| `OPENSEARCH_ENDPOINT` | OpenSearch Serverless endpoint |
| `OPENSEARCH_INDEX` | OpenSearch index name |
| `BEDROCK_MODEL_ID` | Claude model for AI responses |
| `BEDROCK_EMBEDDING_MODEL_ID` | Titan model for embeddings |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `SENTRY_DSN` | Sentry error tracking |

### Frontend Environment Variables

Set via Amplify (configured in `amplify-fe-stack.ts`):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_STAGE` | Environment name |
| `NEXT_PUBLIC_BASE_API_URL` | API Gateway URL |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito Client ID |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | Cognito domain URL |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN |

---

## Multi-Environment Setup

### Current State

Currently, only a **Dev** environment exists. The infrastructure is designed for multi-environment support but requires configuration changes.

### Adding a Production Environment

The stage configuration is now parameterized. You can set the stage via:
- CDK context: `--context stage=Prod`
- Environment variable: `STAGE=Prod`
- Default: `Dev`

**Deploy production stack**:

```bash
cd infrastructure
export STAGE=Prod
export SAM_GOV_API_KEY="your-prod-sam-key"
cdk deploy --all --profile michael-primary --context stage=Prod
```

3. **Update Amplify branch mapping** (already configured):
   - `Dev` stage → `develop` branch
   - `Prod` stage → `main` branch

### Resource Naming by Stage

| Resource | Dev | Prod |
|----------|-----|------|
| DynamoDB | `RFP-table-Dev` | `RFP-table-Prod` |
| S3 Bucket | `auto-rfp-documents-dev-*` | `auto-rfp-documents-prod-*` |
| Cognito | `auto-rfp-users-Dev` | `auto-rfp-users-Prod` |
| API Gateway | `AutoRfp-API-Dev` | `AutoRfp-API-Prod` |

---

## CDK Nag Security Compliance

### Current Status

CDK Nag is **installed but not enabled**. The check is commented out in `auto-rfp-infrastructure.ts`.

### Enabling CDK Nag

1. Uncomment in `infrastructure/bin/auto-rfp-infrastructure.ts`:

```typescript
import { AwsSolutionsChecks } from 'cdk-nag';

// At the end of the file:
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
```

2. Run `cdk synth` to see compliance issues:

```bash
cd infrastructure
cdk synth --profile michael-primary 2>&1 | tee nag-report.txt
```

### Current Suppressions

The following suppressions are already configured in `storage-stack.ts`:

| Rule | Resource | Reason |
|------|----------|--------|
| `AwsSolutions-S1` | S3 Buckets | Server access logging disabled for Dev |
| `AwsSolutions-S10` | S3 Buckets | SSL policy will be added for Prod |

### Adding Suppressions

When CDK Nag identifies issues that are acceptable for your use case:

```typescript
import { NagSuppressions } from 'cdk-nag';

NagSuppressions.addResourceSuppressions(
  myResource,
  [
    {
      id: 'AwsSolutions-XXX',
      reason: 'Documented reason for suppression',
    },
  ],
  true // Apply to children
);
```

---

## Productionization Checklist

### Security

- [ ] **Enable CDK Nag** and resolve all findings
- [ ] **S3 bucket policies** - Add SSL-only access policies
- [ ] **S3 access logging** - Enable for audit trail
- [ ] **CORS restrictions** - Restrict `allowedOrigins` from `*` to specific domains
- [ ] **API Gateway throttling** - Configure rate limits
- [ ] **WAF** - Add Web Application Firewall to API Gateway
- [ ] **VPC endpoints** - Use VPC endpoints for AWS services
- [ ] **Secrets rotation** - Enable automatic rotation for secrets

### Reliability

- [ ] **Multi-AZ deployment** - Ensure Lambda runs in multiple AZs
- [ ] **DynamoDB backups** - Enable point-in-time recovery
- [ ] **S3 versioning** - Already enabled ✓
- [ ] **CloudWatch alarms** - Add alarms for errors and latency
- [ ] **Dead letter queues** - Add DLQ for SQS and Lambda failures

### Monitoring

- [ ] **CloudWatch dashboards** - Create operational dashboards
- [ ] **X-Ray tracing** - Enable distributed tracing
- [ ] **Sentry** - Already configured ✓
- [ ] **Log retention** - Configure appropriate retention periods
- [ ] **Billing alerts** - Set up cost monitoring

### Performance

- [ ] **Lambda provisioned concurrency** - For critical paths
- [ ] **API Gateway caching** - Enable response caching
- [ ] **CloudFront** - Add CDN for static assets
- [ ] **DynamoDB auto-scaling** - Configure read/write capacity

### Compliance

- [ ] **Data encryption** - S3 encryption enabled ✓
- [ ] **IAM least privilege** - Review Lambda IAM roles
- [ ] **Audit logging** - Enable CloudTrail
- [ ] **Data retention policies** - Define and implement

### Operations

- [x] **CI/CD pipeline** - Automated testing and deployment ✓
- [ ] **Blue/green deployments** - Zero-downtime updates
- [ ] **Runbooks** - Document operational procedures
- [ ] **Incident response** - Define escalation procedures

---

## Troubleshooting

### CDK Deployment Fails

```bash
# Check AWS credentials
aws sts get-caller-identity --profile michael-primary

# Bootstrap CDK (first time only)
cdk bootstrap --profile michael-primary

# View detailed error
cdk deploy --verbose --profile michael-primary
```

### Lambda Function Errors

```bash
# View CloudWatch logs
aws logs tail /aws/lambda/AutoRfp-API-Dev-* --follow --profile michael-primary

# Or use AWS Console:
# CloudWatch → Log groups → /aws/lambda/AutoRfp-API-Dev-*
```

### Amplify Build Fails

1. Check Amplify Console → Build history
2. Review build logs for errors
3. Verify `amplify.yml` configuration
4. Ensure `shared` package builds before `web-app`

### OpenSearch Issues

```bash
# Test OpenSearch connectivity (from Lambda or VPC)
curl -XGET "https://leb5aji6vthaxk7ft8pi.us-east-1.aoss.amazonaws.com/_cat/indices"
```

### Missing Environment Variables

Verify Lambda environment in AWS Console:
1. Lambda → Functions → Select function
2. Configuration → Environment variables

---

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) - Development guidelines and architecture
- [infrastructure/README.md](./infrastructure/README.md) - CDK infrastructure details
- [web-app/README.md](./web-app/README.md) - Frontend documentation
