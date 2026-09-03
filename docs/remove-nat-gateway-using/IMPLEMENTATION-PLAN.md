# Implementation Plan: Remove VPC attachment from IndexDocumentLambda

Companion to [`ADR-001`](./ADR-001-remove-vpc-from-index-document-lambda.md).

## Goal

Delete AutoRFP's only VPC-attached Lambda so that no AutoRFP workload depends on the shared `blueprint-checker-vpc-dev` NAT Gateway.

## Pre-flight (do not skip)

1. **Confirm no Pinecone IP allowlist.** Contact the Pinecone account owner. If the account has an IP allowlist tied to the shared VPC's NAT EIP, this migration is blocked until the allowlist is removed (or replaced with an API-key-scoped equivalent).
2. **Confirm no imminent OpenSearch Serverless work.** The Lambda's IAM role has `aoss:APIAccessAll`. If a private-endpoint OpenSearch collection is planned for this pipeline in the next quarter, stop and reconsider.
3. **Confirm no org egress-control policy** requires all data-touching Lambdas to run inside a VPC with security-group egress filtering.

If any of the three is a "yes", stop and revisit the ADR.

## Changes

### 1. `packages/infra/document-pipeline-step-function.ts`

Remove VPC-specific config for `IndexDocumentLambda` (around lines 223-256):

- Delete the `vpc,` line inside the `NodejsFunction` props (line 233).
- Delete the `securityGroups: [vpcSecurityGroup],` line (line 234).
- Delete the `AWSLambdaVPCAccessExecutionRole` managed-policy attach (lines 252-256).

Remove the now-unused stack props (lines 17-41):

- Delete `vpc: ec2.IVpc;` and `vpcSecurityGroup: ec2.ISecurityGroup;` from `DocumentPipelineStackProps`.
- Delete `vpc,` and `vpcSecurityGroup,` from the destructure of `props`.
- Delete the `import * as ec2 from 'aws-cdk-lib/aws-ec2';` line (line 9) — no longer referenced.

### 2. `packages/infra/bin/auto-rfp-infrastructure.ts`

Around line 133, stop passing VPC props into the document-pipeline stack:

- Delete the `vpc: network.vpc,` line (if present).
- Delete the `vpcSecurityGroup: network.lambdaSecurityGroup,` line (line 133).

### 3. `packages/infra/network-stack.ts` (optional cleanup)

`lambdaSecurityGroup` (line 37) becomes dead code. Two options:

- **Keep** it as scaffolding for future VPC-attached Lambdas (zero cost, one construct).
- **Delete** it and its `public readonly lambdaSecurityGroup` export.

Recommendation: keep for now, remove in a follow-up once we're sure no other VPC Lambda is coming.

### 4. Handler code — no change

`apps/functions/src/handlers/document-pipeline-steps/index-document.ts` uses only standard AWS SDK clients and public HTTPS calls. Nothing to modify.

### 5. Tests — no change expected

`apps/functions/src/handlers/document-pipeline-steps/index-document.test.ts` mocks every AWS SDK dependency and knows nothing about the CDK-level VPC config. The suite should pass unchanged.

CDK snapshot tests in `packages/infra` may need `-u` to accept the new synth output; review the diff carefully to confirm it removes exactly the ENI/SG/VPC config and nothing else.

## Deploy

1. Merge to `develop` → auto-deploys to dev.
2. Hotswap is safe here: `pnpm deploy:dev:hotswap`. But since Lambda VPC config is a full-configuration change (not just code), a normal `pnpm deploy:dev` is cleaner.
3. Deploy off-peak or after draining the document-pipeline Step Function queue to avoid in-flight invocation disruption during ENI teardown.

## Verification

- **Functional:** upload a document via the normal ingestion flow. Watch the Step Function execution. Confirm `IndexDocumentLambda` succeeds for every chunk and Pinecone contains the resulting vectors.
- **Bedrock:** confirm at least one chunk uses per-org Bedrock keys (Secrets Manager path) and one uses the default path.
- **Cold start:** compare CloudWatch `INIT_DURATION` for `IndexDocumentLambda` before/after. Expected: significantly lower (no ENI attach).
- **Errors:** watch Sentry for the document-pipeline for 24h. No new categories of network / DNS / connect errors.
- **Egress path:** confirm the Lambda is no longer producing NAT Gateway data-processing traffic (CloudWatch metric on the shared NAT).

## Rollback

Revert the two edited files. Redeploy. The Lambda goes back into the VPC and resumes using the NAT Gateway. No data migration involved — this is a networking change only.

## Post-migration

- Notify the `blueprint-checker` VPC owners that AutoRFP no longer depends on their NAT Gateway. Whether they still need it (or want to migrate to fck-nat as per the original ticket) is their call based on their remaining tenants.
- Update `CLAUDE.md` if the "VPC Lambda" note in the architecture section becomes stale.
