# Spec: Remove VPC attachment from IndexDocumentLambda

Companion to [`ADR-001`](./ADR-001-remove-vpc-from-index-document-lambda.md) and the [Implementation Plan](./IMPLEMENTATION-PLAN.md). See [`GLOSSARY.md`](./GLOSSARY.md) for term definitions.

## Problem Statement

AutoRFP does not own a NAT Gateway, but one of its Lambdas — `IndexDocumentLambda` — is attached to a shared, externally-owned VPC (`blueprint-checker-vpc-dev`) purely for historical reasons, and that VPC's NAT Gateway is the only reason AutoRFP has any dependency on it. This creates three problems for the team operating AutoRFP:

1. A cost/reliability change initiated by another team (replacing that NAT Gateway with EC2 NAT instances) can affect AutoRFP's document-indexing pipeline, even though AutoRFP doesn't use any private resource in that VPC.
2. `IndexDocumentLambda` pays a VPC-attachment cold-start tax (ENI creation) for no functional benefit — it only talks to public HTTPS endpoints (Pinecone, Bedrock, Secrets Manager, S3, DynamoDB).
3. Any future decision about that shared VPC's NAT strategy requires cross-team coordination and AutoRFP sign-off, even though AutoRFP has no private-network dependency that requires it.

## Solution

Remove the VPC attachment from `IndexDocumentLambda` so it runs as a standard (non-VPC) Lambda, like every other AutoRFP Lambda. It will continue reaching Pinecone, Bedrock, Secrets Manager, S3, and DynamoDB over the AWS-managed public path. This fully removes AutoRFP's dependency on the shared NAT Gateway, eliminates the ENI cold-start cost, and decouples AutoRFP from `blueprint-checker`'s NAT strategy decisions.

## User Stories

1. As a platform engineer, I want `IndexDocumentLambda` to run outside any VPC, so that AutoRFP no longer depends on a NAT Gateway owned by another team.
2. As a platform engineer, I want the `DocumentPipelineStack` to no longer require `vpc` / `vpcSecurityGroup` props, so that the stack's public interface reflects that it has no VPC dependency.
3. As a platform engineer, I want the CDK entrypoint (`bin/auto-rfp-infrastructure.ts`) to stop wiring VPC/security-group values into the document-pipeline stack, so that dead configuration doesn't linger in the infra code.
4. As a platform engineer, I want to keep `NetworkStack.lambdaSecurityGroup` in place (not delete it) for now, so that a future VPC-attached Lambda has scaffolding ready without a fresh infra change.
5. As an on-call engineer, I want document indexing (chunk embedding + Pinecone write) to keep working exactly as before the migration, so that this networking-only change causes zero functional regression.
6. As an on-call engineer, I want per-org Bedrock API key lookups (Secrets Manager) to keep working unchanged, so that org-scoped embedding calls are unaffected.
7. As an on-call engineer, I want the existing `index-document.test.ts` Jest suite to pass without modification, so that I have confidence the handler code itself needs no change.
8. As a platform engineer, I want a CDK-level test asserting `IndexDocumentLambda`'s synthesized `AWS::Lambda::Function` resource has no `VpcConfig`, so that a future change can't silently reintroduce the VPC attachment without a test failing.
9. As a platform engineer, I want to confirm before merging that no IP-allowlist on the Pinecone account is tied to the shared VPC's NAT Elastic IP, so that indexing doesn't start failing once the Lambda's egress IP changes.
10. As a platform engineer, I want to confirm before merging that no near-term plan requires this pipeline to reach a private-endpoint OpenSearch Serverless collection, so that removing VPC access doesn't block already-planned work (the unused `aoss:APIAccessAll` permission is the flag prompting this check).
11. As a platform engineer, I want to confirm before merging that no organizational egress-control policy mandates VPC-scoped security-group filtering for data-touching Lambdas, so that this change doesn't violate a compliance requirement.
12. As a platform engineer, I want to deploy this change as a full (non-hotswap) `pnpm deploy:dev`, so that the Lambda's VPC configuration (not just its code) is correctly updated.
13. As an on-call engineer, I want to compare `IndexDocumentLambda`'s CloudWatch `INIT_DURATION` before and after deploy, so that I can confirm the expected cold-start improvement.
14. As an on-call engineer, I want to watch Sentry for the document-pipeline for 24h post-deploy, so that any unexpected network/DNS/connect error category is caught quickly.
15. As a platform engineer, I want to confirm via a CloudWatch NAT Gateway data-processing metric that `IndexDocumentLambda` produces zero NAT traffic after deploy, so that I have concrete evidence the dependency is gone.
16. As a platform engineer, I want to notify the `blueprint-checker` VPC owners once this ships, so that they know AutoRFP no longer needs their NAT Gateway and can make their own decision about it (e.g. the original EC2-NAT-instance / fck-nat migration) without waiting on AutoRFP.
17. As a platform engineer, if something goes wrong post-deploy, I want a rollback that's a straight revert-and-redeploy of the two edited files, so that recovery doesn't involve any data migration.

## Implementation Decisions

- **Scope is infra-only.** No changes to `apps/functions/src/handlers/document-pipeline-steps/index-document.ts` — it already only uses standard AWS SDK clients and public HTTPS calls.
- **`packages/infra/document-pipeline-step-function.ts`:**
  - `DocumentPipelineStackProps` drops the `vpc: ec2.IVpc` and `vpcSecurityGroup: ec2.ISecurityGroup` fields.
  - The constructor's destructure of `props` drops `vpc` and `vpcSecurityGroup`.
  - The `IndexDocumentLambda` `NodejsFunction` construct drops its `vpc` and `securityGroups` props entirely (so it synthesizes with no `VpcConfig`).
  - The `indexDocumentLambda.role?.addManagedPolicy(...AWSLambdaVPCAccessExecutionRole...)` call is removed — that managed policy is only needed for VPC ENI management permissions.
  - The now-unused `import * as ec2 from 'aws-cdk-lib/aws-ec2'` is removed.
  - No other Lambda in this stack (`ChunkDocumentLambda`, Textract-related resources, etc.) is touched — only `IndexDocumentLambda` was ever VPC-attached.
  - The `aoss:APIAccessAll` IAM policy statement and other IAM grants on `indexDocumentLambda` are left untouched — they're unrelated to VPC attachment and out of scope for this change (see ADR-001 risk #2 for why the permission itself is unresolved, but not blocking).
- **`packages/infra/bin/auto-rfp-infrastructure.ts`:** the `DocumentPipelineStack` instantiation (around line 132-133) drops the `vpc: network.vpc` and `vpcSecurityGroup: network.lambdaSecurityGroup` props passed in.
- **`packages/infra/network-stack.ts`:** `NetworkStack.lambdaSecurityGroup` and the VPC lookup/creation logic are left in place, unused by any stack after this change. This is a deliberate choice to keep scaffolding for a possible future VPC-attached Lambda, not an oversight — a follow-up ticket can remove it later if no such Lambda materializes.
- **No schema changes.** No `packages/core` Zod schemas are affected.
- **No API contract changes.** No handler request/response shapes change.
- **Deploy mechanics:** use a full `pnpm deploy:dev` (not `deploy:dev:hotswap`), because Lambda VPC config is a full-resource-configuration change, not a code-only change hotswap can apply. Deploy off-peak or after draining the document-pipeline Step Function queue, since removing VPC config replaces the Lambda's ENI configuration and may cause a brief invocation disruption.
- **Pre-flight gate (must be confirmed, and by whom, before merging):**
  1. Pinecone account owner confirms no IP allowlist is tied to the shared VPC's NAT Elastic IP.
  2. No near-term plan exists for a private-endpoint OpenSearch Serverless collection on this pipeline (the unused `aoss:APIAccessAll` grant is the signal prompting this check).
  3. No org egress-control policy requires VPC + security-group egress filtering for data-touching Lambdas.
  If any of these is unresolved or answered "yes," the migration is blocked and ADR-001 should be revisited (see ADR-001 Alternatives A/B).
- **Rollback plan:** revert `document-pipeline-step-function.ts` and `bin/auto-rfp-infrastructure.ts` to their pre-change state and redeploy. Purely a networking rollback — no data migration.
- **Post-migration follow-up:** notify `blueprint-checker` VPC owners that AutoRFP no longer depends on their NAT Gateway; update `CLAUDE.md` if it references a "VPC Lambda" anywhere in its architecture notes (it currently does not).

## Testing Decisions

- **Primary seam: a CDK `Template` assertion test on `DocumentPipelineStack`**, following the exact pattern already used for sibling step-function stacks in this repo (`packages/infra/question-pipeline-step-function.test.ts`, `packages/infra/answer-generation-step-function.test.ts`): synth the stack with `Template.fromStack(stack)` against mock `IBucket`/`ITable` fakes, then assert on the synthesized `AWS::Lambda::Function` resource for `IndexDocumentLambda`.
  - This is the single highest, most durable seam — it tests the actual CloudFormation output rather than the CDK source, so it fails if a future PR reintroduces `vpc`/`securityGroups` on this Lambda in any form.
  - A good test here: only assert on the external behavior (the synthesized resource has no `VpcConfig` property, and the stack no longer requires VPC props to construct), not on internal implementation details like which line the `vpc,` prop used to sit on.
  - This test does not currently exist for `document-pipeline-step-function.ts` and should be added as part of this change (new file `packages/infra/document-pipeline-step-function.test.ts`, mirroring the `beforeEach` / mock-bucket / mock-table / `Template.fromStack` setup in `question-pipeline-step-function.test.ts`).
- **No handler-level test changes.** `apps/functions/src/handlers/document-pipeline-steps/index-document.test.ts` mocks all AWS SDK dependencies and has no knowledge of CDK-level VPC config; it's expected to pass unchanged and is not a seam for this change.
- **CDK snapshot tests (if any exist for this stack) may need `-u`** to accept the new synth output. Given no snapshot test currently exists for `document-pipeline-step-function.ts` specifically, this is a "if applicable" note rather than a required step — any diff produced should be reviewed to confirm it removes exactly the VPC/security-group/ENI config and nothing else.
- **Manual/deploy-time verification (not automated tests, but required before calling this done):**
  - End-to-end functional check: upload a document, watch the Step Function execution, confirm `IndexDocumentLambda` succeeds for every chunk, confirm Pinecone contains the resulting vectors.
  - Confirm at least one chunk uses per-org Bedrock keys (Secrets Manager path) and one uses the default path.
  - Compare CloudWatch `INIT_DURATION` for `IndexDocumentLambda` before/after — expect a noticeable drop.
  - Watch Sentry for the document-pipeline for 24h post-deploy for any new network/DNS/connect error category.
  - Confirm via the shared NAT Gateway's CloudWatch data-processing metric that it no longer receives traffic attributable to AutoRFP.

## Out of Scope

- Executing the original ticket as written (2× EC2 NAT instances / `fck-nat` with route-table failover in the shared `blueprint-checker` VPC) — this is explicitly rejected by ADR-001 in favor of removing AutoRFP's NAT dependency altogether.
- Adding VPC Interface/Gateway Endpoints for Bedrock, Secrets Manager, S3, or DynamoDB — considered and rejected as Alternative B in ADR-001 (more infra surface for less benefit, since Pinecone still requires public egress regardless).
- Deleting `NetworkStack.lambdaSecurityGroup` or the VPC lookup/creation logic in `network-stack.ts` — deliberately deferred to a future follow-up ticket.
- Any change to the `aoss:APIAccessAll` IAM permission on `IndexDocumentLambda` — flagged as a risk to investigate (pre-flight check #2) but not something this change resolves or removes.
- Any change to `ChunkDocumentLambda` or any other Lambda in the document pipeline — none of them were ever VPC-attached.
- Cross-repo changes to `blueprint-checker`'s own infrastructure or NAT strategy — out of AutoRFP's ownership; this spec only removes AutoRFP's *dependency* on that VPC, it does not instruct the other team on what to do with their NAT Gateway.
- Any data migration — this is a networking-only change with no data-shape or storage implications.

## Further Notes

- The three pre-flight checks (Pinecone IP allowlist, OpenSearch Serverless plans, org egress-control policy) are process gates owned by a human, not something a test can verify — they must be confirmed by the relevant stakeholders before the PR implementing this spec is merged, per the Implementation Plan's "Pre-flight (do not skip)" section.
- `blueprint-checker-vpc-dev` (`vpc-0e8bca582530ec949`) is consumed via `Vpc.fromLookup` in `packages/infra/bin/auto-rfp-infrastructure.ts:60` and is owned by another team — AutoRFP has no authority over its NAT Gateway, only over whether AutoRFP's own workloads depend on it.
- After this change, `IndexDocumentLambda` becomes a standard (non-VPC) Lambda consistent with every other AutoRFP Lambda, removing a structural inconsistency as well as the NAT dependency.
