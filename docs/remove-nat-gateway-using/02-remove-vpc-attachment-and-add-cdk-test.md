# 02 — Remove VPC attachment from IndexDocumentLambda + CDK regression test

**What to build:** `IndexDocumentLambda` becomes a standard (non-VPC) Lambda, matching every other AutoRFP Lambda, with a durable CDK-level test that fails if VPC attachment is ever reintroduced.

Specifically:

- `packages/infra/document-pipeline-step-function.ts`: `DocumentPipelineStackProps` no longer takes `vpc` / `vpcSecurityGroup`; the constructor no longer destructures them; the `IndexDocumentLambda` `NodejsFunction` construct no longer sets `vpc` or `securityGroups`; the `AWSLambdaVPCAccessExecutionRole` managed-policy attach is removed; the now-unused `import * as ec2 from 'aws-cdk-lib/aws-ec2'` is removed. No other Lambda in this stack is touched, and the `aoss:APIAccessAll` IAM statement and other IAM grants on `indexDocumentLambda` are left as-is.
- `packages/infra/bin/auto-rfp-infrastructure.ts`: the `DocumentPipelineStack` instantiation no longer passes `vpc: network.vpc` or `vpcSecurityGroup: network.lambdaSecurityGroup`.
- `packages/infra/network-stack.ts`: left untouched — `lambdaSecurityGroup` and the VPC lookup/creation logic stay in place as unused scaffolding (explicitly deferred, not this ticket's job).
- New test `packages/infra/document-pipeline-step-function.test.ts`, mirroring the `beforeEach` / mock-bucket / mock-table / `Template.fromStack` setup already used in `packages/infra/question-pipeline-step-function.test.ts` and `answer-generation-step-function.test.ts`. It synths `DocumentPipelineStack` and asserts the `IndexDocumentLambda` `AWS::Lambda::Function` resource has no `VpcConfig` property, and that the stack constructs without VPC props.
- No change to `apps/functions/src/handlers/document-pipeline-steps/index-document.ts` or its test — confirm `index-document.test.ts` still passes unchanged.

**Blocked by:** 01 — Pre-flight risk-gate confirmation (all three risks must be resolved before this work proceeds).

**Status:** ready-for-agent

- [ ] `DocumentPipelineStackProps` no longer declares `vpc` or `vpcSecurityGroup`
- [ ] `IndexDocumentLambda`'s `NodejsFunction` construct has no `vpc` or `securityGroups` props
- [ ] `AWSLambdaVPCAccessExecutionRole` managed-policy attach is removed from `indexDocumentLambda`
- [ ] Unused `import * as ec2 from 'aws-cdk-lib/aws-ec2'` is removed from `document-pipeline-step-function.ts`
- [ ] `bin/auto-rfp-infrastructure.ts` no longer passes `vpc` / `vpcSecurityGroup` into `DocumentPipelineStack`
- [ ] `network-stack.ts` is unmodified (VPC lookup and `lambdaSecurityGroup` remain in place)
- [ ] New `packages/infra/document-pipeline-step-function.test.ts` synths the stack and asserts the `IndexDocumentLambda` resource has no `VpcConfig`
- [ ] `pnpm --filter @auto-rfp/infra test` (or equivalent) passes, including the new test
- [ ] `apps/functions/src/handlers/document-pipeline-steps/index-document.test.ts` passes unchanged
- [ ] `cd packages/infra && pnpm build` (tsc) succeeds with no type errors
