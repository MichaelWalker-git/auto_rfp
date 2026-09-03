# ADR-001: Remove VPC attachment from IndexDocumentLambda

- **Status:** Proposed
- **Date:** 2026-09-03
- **Deciders:** Platform / Infra

## Context

The ticket "Replace NAT Gateway with EC2 NAT instances" is motivated by the cost and single-point-of-failure profile of the managed NAT Gateway currently used by AutoRFP-adjacent workloads.

Investigation showed:

- AutoRFP does not own a NAT Gateway. It consumes an external VPC (`blueprint-checker-vpc-dev`, id `vpc-0e8bca582530ec949`) via `Vpc.fromLookup` in `packages/infra/bin/auto-rfp-infrastructure.ts:60`. The NAT Gateway lives in that shared VPC, owned by another team.
- Only **one** AutoRFP workload runs inside that VPC: `IndexDocumentLambda`, defined in `packages/infra/document-pipeline-step-function.ts:223-247`. Every other Lambda runs outside any VPC.
- `IndexDocumentLambda` (see `apps/functions/src/handlers/document-pipeline-steps/index-document.ts`) does not communicate with any private VPC resource. Its network dependencies are all public / regional AWS service endpoints:
  - Pinecone (public SaaS)
  - Bedrock (`bedrock:InvokeModel` for `amazon.titan-embed-text-v2:0`)
  - Secrets Manager (`bedrock-api-key-<orgId>`)
  - S3 (chunk text)
  - DynamoDB (mark-indexed writes)
- An `aoss:APIAccessAll` IAM policy is attached (line 265-271), but the handler never calls OpenSearch Serverless.
- The Lambda is inside the VPC purely as a structural / historical choice, not because it needs to reach a private resource. Being inside a VPC is precisely what forces its egress through NAT.

Executing the ticket as originally proposed (2× EC2 NAT instances with fck-nat + route-table failover) would require:

- A cross-repo PR into `blueprint-checker` (we do not own its route tables or NAT resources).
- Coordination with every other tenant of that shared VPC.
- Cross-tenant validation before decommissioning the NAT Gateway (AutoRFP alone cannot sign off).

## Decision

Remove the VPC attachment from `IndexDocumentLambda`. It will run as a standard (non-VPC) Lambda and reach Pinecone, Bedrock, Secrets Manager, S3, and DynamoDB over the AWS-managed public path — the same path every other AutoRFP Lambda already uses.

This eliminates AutoRFP's dependency on the shared NAT Gateway entirely. Whether the NAT Gateway → EC2 NAT-instance migration should still proceed becomes a decision for the `blueprint-checker` owners based on their remaining tenants, not one AutoRFP has to weigh in on.

## Consequences

### Positive

- **Zero NAT egress from AutoRFP.** No workload of ours needs the shared NAT after this change.
- **Faster cold starts.** No ENI attachment on Lambda init.
- **Simpler infra.** `vpc` and `vpcSecurityGroup` props can be dropped from `DocumentPipelineStack`; the `LambdaSecurityGroup` in `network-stack.ts` becomes unused and can be removed.
- **Cross-team decoupling.** AutoRFP no longer cares which VPC / NAT strategy `blueprint-checker` runs.

### Negative / Risks

1. **Loss of a static egress IP.** If Pinecone (or any downstream) has an IP allowlist tied to the NAT Gateway's Elastic IP, the Lambda will start being rejected. Standard Pinecone plans do not require IP allowlisting; enterprise / private-link configurations do. **Must confirm with the Pinecone account owner before merging.**
2. **Latent OpenSearch plans.** The unused `aoss:APIAccessAll` permission suggests someone once intended to call OpenSearch Serverless. If a private OpenSearch collection is on the near-term roadmap for this pipeline, keeping the Lambda in VPC (behind a private endpoint) may be the right long-term shape. **Confirm no such plan exists.**
3. **Egress control policy.** If organizational policy requires audited, controlled egress for Lambdas that touch customer data, running outside a VPC removes the security-group-based egress filter. Lambda runs in an AWS-managed sandbox regardless, but a security-review lens may still flag this.
4. **Rollout blip.** Removing the VPC config replaces the Lambda function's ENI configuration; there may be a brief invocation disruption during deploy. Mitigate by deploying off-peak or when the Step Function queue is drained.

## Alternatives considered

- **A. Execute the ticket as written.** 2× EC2 NAT instances (or `fck-nat`) with health-checked failover in the shared VPC. Technically sound, but blocked by cross-team ownership and does not remove AutoRFP's NAT dependency, only changes its shape.
- **B. Add VPC Interface Endpoints** for Bedrock, Secrets Manager and a Gateway endpoint for S3/DynamoDB, keeping the Lambda in VPC. Would cut most NAT-billable traffic but leaves the Lambda in VPC for no functional reason and still routes Pinecone through NAT. More surface area, less benefit.
- **C. Remove the VPC attachment (chosen).** Smallest possible change, fully within AutoRFP's ownership, removes the NAT dependency entirely.

## Verification

- Pinecone indexing succeeds end-to-end after deploy (document upload → chunks → indexed in Pinecone).
- Bedrock embeddings call succeeds.
- Per-org Bedrock API key fetch from Secrets Manager succeeds.
- Existing Jest suite (`index-document.test.ts`) passes unchanged.
- Cold-start time (CloudWatch INIT_DURATION) drops noticeably.
- No new errors in Sentry for the document-pipeline queue for 24h post-deploy.
