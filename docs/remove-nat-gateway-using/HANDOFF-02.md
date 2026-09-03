# Handoff — Ticket 02: Remove VPC attachment from IndexDocumentLambda

**Status:** Implementation complete and verified. **Not staged, not committed.** Code review not yet run.

**Branch:** `develop`
**Repo root:** `/home/user/WebstormProjects/auto_rfp`
**Spec:** `docs/remove-nat-gateway-using/02-remove-vpc-attachment-and-add-cdk-test.md`

## Why this handoff exists

The tool safety classifier went into a sustained rate-limit outage, which blocked all `Bash` and `Agent` calls. File reads/writes still worked, so the code is written and on disk — but `git add`, the final full-suite run, and `/code-review` could not be executed. Everything below was verified *before* the outage.

## Files changed (3)

### 1. `packages/infra/document-pipeline-step-function.ts` (modified)

- Removed `vpc: ec2.IVpc` and `vpcSecurityGroup: ec2.ISecurityGroup` from `DocumentPipelineStackProps`.
- Removed `vpc` / `vpcSecurityGroup` from the constructor destructure.
- Removed `vpc` and `securityGroups: [vpcSecurityGroup]` from the `IndexDocumentLambda` `NodejsFunction` construct.
- Removed the `indexDocumentLambda.role?.addManagedPolicy(...AWSLambdaVPCAccessExecutionRole)` block.
- Removed the now-unused `import * as ec2 from 'aws-cdk-lib/aws-ec2'`.

Left intact, as the spec required: the `aoss:APIAccessAll`, `bedrock:InvokeModel`, and `secretsmanager:GetSecretValue` policy statements, the S3/DynamoDB grants, and every other Lambda in the stack.

### 2. `packages/infra/bin/auto-rfp-infrastructure.ts` (modified)

- `DocumentPipelineStack` instantiation no longer passes `vpc: network.vpc` or `vpcSecurityGroup: network.lambdaSecurityGroup`.
- **Deviation from spec — please review:** changed `const network = new NetworkStack(...)` to `new NetworkStack(...)`. Once the two props above were dropped, `network` had no remaining references in the file, and `tsconfig.json` has `noUnusedLocals: true`, so `tsc` failed with `TS6133: 'network' is declared but its value is never read`. The `NetworkStack` is still instantiated (stack still synthesizes and deploys); only the unused variable binding was dropped. This was the minimal fix, but it is one line beyond what the ticket literally listed.

### 3. `packages/infra/document-pipeline-step-function.test.ts` (new)

Mirrors the `beforeEach` / mock-bucket / mock-table / `Template.fromStack` setup from `question-pipeline-step-function.test.ts` and `answer-generation-step-function.test.ts`. Single assertion:

```ts
template.hasResourceProperties('AWS::Lambda::Function', {
  FunctionName: 'AutoRfp-test-IndexDocumentChunk',
  VpcConfig: Match.absent(),
});
```

Note: an earlier draft used `findResources` + a manual `VpcConfig === undefined` check; it was replaced with `Match.absent()` as the more idiomatic CDK assertion. The test passed in both forms.

`network-stack.ts` was **not** modified, per the ticket.

## Verification already done (all passing)

| Check | Result |
|---|---|
| `cd packages/infra && pnpm build` (tsc) | clean, no errors |
| `cd packages/infra && pnpm test -- document-pipeline-step-function.test.ts` | 1 suite, 1 test passed |
| `cd packages/infra && pnpm test` (full) | 5 suites, 27 tests passed |
| `cd apps/functions && npx jest src/handlers/document-pipeline-steps/index-document.test.ts` | 1 suite, 18 tests passed, unchanged |

Caveat: the full `packages/infra` suite was run against the *earlier* version of the new test (the `findResources` form, which had 2 tests). After switching to `Match.absent()`, only the single new test file and `pnpm build` were re-run — both passed. Re-running the full infra suite is cheap and worth doing first thing.

## Remaining steps

1. Re-run `cd packages/infra && pnpm test` to confirm the full suite is green with the final version of the test.
2. Run `/code-review` (never executed — the `Agent` tool was blocked the whole time). Ask it specifically about: the `const network` deviation in item 2 above, and whether the new test is a genuine regression guard.
3. Stage:
   ```bash
   cd /home/user/WebstormProjects/auto_rfp && git add \
     packages/infra/document-pipeline-step-function.ts \
     packages/infra/bin/auto-rfp-infrastructure.ts \
     packages/infra/document-pipeline-step-function.test.ts
   ```
4. Show the user the staged diff and get approval before committing.

Note there are two pre-existing untracked paths unrelated to this ticket — `apps/web/cypress/e2e/09b-org-documents-doc-crud.cy.js` and `docs/remove-nat-gateway-using/` (which now also contains this handoff file). Do not sweep them in with a broad `git add`.

## Proposed commit message

```
fix(infra): remove VPC attachment from IndexDocumentLambda

Matches every other AutoRFP Lambda by dropping the vpc/securityGroups
config and AWSLambdaVPCAccessExecutionRole grant, and adds a CDK test
that fails if VPC attachment is ever reintroduced.
```

## Spec checklist status

- [x] `DocumentPipelineStackProps` no longer declares `vpc` or `vpcSecurityGroup`
- [x] `IndexDocumentLambda`'s `NodejsFunction` construct has no `vpc` or `securityGroups` props
- [x] `AWSLambdaVPCAccessExecutionRole` managed-policy attach removed
- [x] Unused `ec2` import removed
- [x] `bin/auto-rfp-infrastructure.ts` no longer passes `vpc` / `vpcSecurityGroup`
- [x] `network-stack.ts` unmodified
- [x] New CDK test synths the stack and asserts no `VpcConfig`
- [x] `pnpm --filter @auto-rfp/infra test` passes — *re-confirm after the final test edit*
- [x] `index-document.test.ts` passes unchanged
- [x] `cd packages/infra && pnpm build` succeeds
