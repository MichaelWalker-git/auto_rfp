# Deploy Runbook: Remove VPC attachment from IndexDocumentLambda

Operational instructions for an agent/engineer deploying this change to a new
environment (test, prod, or re-deploying dev). Companion to
[`SPEC.md`](./SPEC.md), [`03-deploy-to-dev-and-verify.md`](./03-deploy-to-dev-and-verify.md).

This document exists because the dev deploy hit a CloudFormation cross-stack
export deadlock that is **not** dev-specific — it will reproduce on the first
deploy of this change to any environment. Read "Known Issue" before running
anything.

## Pre-flight

Confirm before deploying, not after:

1. The pre-flight gate in [`01-preflight-risk-gate-confirmation.md`](./01-preflight-risk-gate-confirmation.md)
   has actually been signed off by a human (Pinecone IP allowlist, OpenSearch
   Serverless plans, org egress policy). This is a process gate, not something
   you can verify from the CLI.
2. `cd packages/infra && pnpm build && pnpm test` is green.
3. Confirm the target environment currently has the *old* (VPC-attached)
   config, so you know what "fixed" should look like after:
   ```bash
   aws lambda get-function-configuration \
     --function-name AutoRfp-<Stage>-IndexDocumentChunk \
     --query VpcConfig --output json
   ```
   (`<Stage>` is `Dev`, `Test`, etc. — matches the `STAGE` env var, capitalized.)

## Known issue: cross-stack export deadlock

`packages/infra/bin/auto-rfp-infrastructure.ts` no longer passes
`vpc`/`vpcSecurityGroup` into `DocumentPipelineStack`, so
`DocumentPipelineStack` no longer references
`NetworkStack.lambdaSecurityGroup`. Because `cdk.json` sets
`"@aws-cdk/core:stackRelativeExports": true`, CDK's synth of `NetworkStack`
stops emitting the `LambdaSecurityGroup` export once nothing in the app model
references it.

`cdk deploy --all` always deploys `NetworkStack` **before**
`DocumentPipelineStack` (the inferred dependency direction runs
Network → DocumentPipeline). On the first deploy of this change, that means:

1. CloudFormation starts updating `AutoRfp-Network-<Stage>` and tries to drop
   the now-unused export.
2. `AutoRfp-DocumentPipeline-<Stage>` hasn't been updated yet — its
   *currently deployed* template still has `Fn::ImportValue` pointing at that
   export.
3. CloudFormation refuses:
   ```
   Cannot delete export AutoRfp-Network-<Stage>:...LambdaSecurityGroup...GroupId
   as it is in use by AutoRfp-DocumentPipeline-<Stage>
   ```
4. `AutoRfp-Network-<Stage>` rolls back to `UPDATE_ROLLBACK_COMPLETE`, and the
   whole `pnpm deploy:<stage>` run aborts with exit code 1 — **before
   `DocumentPipelineStack` is ever touched.** The Lambda silently stays
   VPC-attached. Nothing in the CLI output makes this obvious; you have to
   scroll back to find the `❌` line.

This is a one-time issue per environment. Once `DocumentPipelineStack` has
been redeployed without the import, subsequent `NetworkStack` deploys work
normally.

### Fix: deploy the consumer stack first

```bash
cd packages/infra

# Step 1 — deploy ONLY DocumentPipelineStack, to drop its import of
# NetworkStack's export. Ignore that this looks redundant with step 2.
STAGE=<Stage> npx cdk deploy AutoRfp-DocumentPipeline-<Stage> \
  --exclusively --require-approval never

# Step 2 — now the normal full deploy works, since nothing imports the
# export anymore.
STAGE=<Stage> pnpm deploy:<stage>          # or: pnpm --filter @auto-rfp/infra deploy:<stage>
```

`<stage>` lowercase for the pnpm script name (`deploy:dev`, `deploy:test`),
`<Stage>` capitalized for `STAGE=` and stack names (`Dev`, `Test`).

Do **not** use `deploy:<stage>:hotswap` for this change — Lambda `VpcConfig`
is a full-resource-configuration change, not a code-only change; hotswap
skips it silently and leaves the Lambda VPC-attached while looking like it
succeeded.

Expect both commands together to take on the order of 10–15 minutes — CDK
bundles every Lambda in the app for each `cdk deploy`, and that dominates the
wall-clock time, not the actual stack update.

## Post-deploy verification (automatable, do all of these)

```bash
STAGE_LOWER=<stage>   # e.g. Dev, Test — matches Lambda function name casing

# 1. Live Lambda has no VpcConfig
aws lambda get-function-configuration \
  --function-name AutoRfp-<Stage>-IndexDocumentChunk \
  --query "{Vpc:VpcConfig,Update:LastUpdateStatus}" --output json
# Expect: VpcConfig subnet/SG fields present but EMPTY, LastUpdateStatus=Successful

# 2. IAM role no longer has the VPC execution policy
aws iam list-attached-role-policies \
  --role-name <IndexDocumentLambdaServiceRole-from-stack-output-or-console> \
  --query "AttachedPolicies[].PolicyName" --output text
# Expect: AWSLambdaBasicExecutionRole present, AWSLambdaVPCAccessExecutionRole ABSENT

# 3. Deployed CloudFormation template (not just synth output) has no VpcConfig
aws cloudformation get-template \
  --stack-name AutoRfp-DocumentPipeline-<Stage> --template-stage Original \
  --output json | python3 -c "
import json,sys
b=json.load(sys.stdin)['TemplateBody']
p=b['Resources']['IndexDocumentLambdaAD264DA8']['Properties']
print('VpcConfig:', p.get('VpcConfig'))
"
# Expect: VpcConfig: None

# 4. No AutoRFP Lambda remains in the shared VPC
aws lambda list-functions \
  --query "Functions[?VpcConfig.VpcId=='vpc-0e8bca582530ec949'].FunctionName" \
  --output text | tr '\t' '\n' | grep -i autorfp
# Expect: no output (grep finds nothing) once all environments are migrated.
# A single environment's deploy will still show sibling environments
# (e.g. AutoRfp-Dev-IndexDocumentChunk) until they're migrated too — that's
# expected, not a failure of *this* deploy.
```

Steps 1–3 must all agree before calling the deploy done. Checking only the
live Lambda config (step 1) is not sufficient — a concurrent deploy from
someone else's branch can silently re-add `VpcConfig` minutes later (see
"Watch out for concurrent deploys" below). Re-run step 1 again immediately
before the functional check in the next section, not just once after the
deploy command exits.

## Functional check (required — do not skip)

The point of this migration is that Bedrock/Pinecone/Secrets Manager calls
now go over the public path instead of NAT. Only a real invocation proves
that works. Prefer re-indexing an **existing, already-indexed chunk** — the
Pinecone chunk ID is deterministic (`${document.SK}#${chunkKey}`), so
re-indexing is an idempotent upsert, not new data.

```bash
# 1. Find a real, already-indexed document + chunk for an org that HAS a
#    Bedrock key configured (so you exercise the Secrets Manager path):
aws secretsmanager list-secrets \
  --query "SecretList[?contains(Name,'bedrock-api-key')].Name" --output text

aws dynamodb query --table-name RFP-table-<Stage> \
  --key-condition-expression "partition_key = :pk" \
  --expression-attribute-values '{":pk":{"S":"DOCUMENT"}}' \
  --output json
# Pick an item where indexStatus=INDEXED and the textFileKey's org_<id>
# prefix matches one of the secret names above.

# 2. Confirm the chunk object actually exists in S3 (chunks/<n>.txt under the
#    document's prefix) — use that exact key as chunkKey below.

# 3. Invoke directly (bypasses the Step Function, isolates the Lambda):
cat > /tmp/payload.json <<'EOF'
{
  "orgId": "<org-id>",
  "knowledgeBaseId": "<kb-id>",
  "documentId": "<document-id>",
  "chunkKey": "<full-s3-key-to-chunks/1.txt>"
}
EOF

aws lambda invoke --function-name AutoRfp-<Stage>-IndexDocumentChunk \
  --payload fileb:///tmp/payload.json --cli-read-timeout 180 /tmp/resp.json \
  --query "{Status:StatusCode,FunctionError:FunctionError}" --output json
cat /tmp/resp.json
```

Expect `StatusCode: 200`, `FunctionError: null`, and a response body with
`"success":true` and a non-empty `"pineconeId"`. A non-empty `pineconeId`
means `getEmbedding` (Bedrock, via Secrets Manager) succeeded, since it's
awaited before the Pinecone upsert — no separate Bedrock-specific check is
needed.

There is **no "default Bedrock key" fallback path to test separately.**
`apps/functions/src/helpers/bedrock-http-client.ts` resolves the Bedrock key
per-org from Secrets Manager only, fails closed (`AiNotConfiguredError`) if
missing. If `03-deploy-to-dev-and-verify.md` or `IMPLEMENTATION-PLAN.md`
still lists "confirm default Bedrock key path" as a checklist item, treat it
as stale — there is nothing to check there.

Then confirm no errors and pull the cold-start number:

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/AutoRfp-<Stage>-DocumentPipeline" \
  --start-time $(( ($(date +%s) - 600) * 1000 )) \
  --filter-pattern "?ERROR ?Exception ?ETIMEDOUT ?ENOTFOUND ?ECONNRESET ?AiNotConfigured" \
  --query "events[].message" --output text
# Expect: empty

aws logs filter-log-events \
  --log-group-name "/aws/lambda/AutoRfp-<Stage>-DocumentPipeline" \
  --start-time $(( ($(date +%s) - 600) * 1000 )) \
  --query "events[?contains(logStreamName,'IndexDocumentChunk')]" --output json
# Look for the "REPORT ... Init Duration: N ms" line matching your invoke's RequestId.
```

Note: that log group is shared by every Lambda in the document pipeline
(`StartProcessing`, `ChunkDocument`, etc.), so filter by `logStreamName`
containing `IndexDocumentChunk`, not just by `REPORT`.

**Cold-start expectation, corrected:** the spec/ADR expect `INIT_DURATION` to
drop after removing VPC attachment. In dev this did **not** hold — VPC-attached
runs measured ~735–780 ms `INIT_DURATION`, non-VPC runs measured ~727–835 ms.
Statistically the same; Lambda's Hyperplane ENI model removed the classic
cold-start-on-VPC-attach penalty years ago. Record the number for the
before/after table, but don't treat a lack of improvement as a deploy failure
or something to re-investigate — the NAT/ownership decoupling is still the
real win, the cold-start claim in ADR-001 is simply outdated.

## Watch out for concurrent deploys

If another engineer deploys `AutoRfp-DocumentPipeline-<Stage>` (or `--all`)
from a branch that doesn't have this change while you're mid-verification,
it will silently re-add `VpcConfig` and the `AWSLambdaVPCAccessExecutionRole`
policy, with no error — CloudFormation just applies the "old" desired state
because that's what their template says.

If your functional-check invoke's timestamp is suspiciously close to another
`UPDATE_COMPLETE` on the same stack, re-check stack events before trusting
the result:

```bash
aws cloudformation describe-stack-events \
  --stack-name AutoRfp-DocumentPipeline-<Stage> --max-items 15 \
  --query "StackEvents[].[Timestamp,ResourceStatus,LogicalResourceId]" --output text
```

If you find a revert, redeploy (Step 1 + 2 above, in that order again — the
export deadlock can recur if Network's export was re-created by the revert)
and re-run the functional check. Don't report success from an invoke that
ran after a revert without checking this first.

## Remaining manual/longer-running checks

Not automatable from a single agent session — hand off or schedule:

- **24h Sentry watch** on the document-pipeline for any new network/DNS/connect
  error category.
- **NAT Gateway CloudWatch metric** (`AWS/NATGateway` `BytesOutToDestination`,
  dimension `NatGatewayId`) trending to zero attributable traffic over the
  following days — a single post-deploy snapshot only proves the Lambda isn't
  in the VPC anymore (see verification step 4), not that traffic has stopped
  long-term.

## If something goes wrong

Rollback is a straight revert-and-redeploy of `document-pipeline-step-function.ts`
and `bin/auto-rfp-infrastructure.ts` to their pre-change state, then the same
two-step deploy (consumer stack first, exclusively) — the export deadlock
runs in reverse too if `NetworkStack`'s export needs to reappear before
`DocumentPipelineStack` can re-import it. No data migration involved either
direction.
