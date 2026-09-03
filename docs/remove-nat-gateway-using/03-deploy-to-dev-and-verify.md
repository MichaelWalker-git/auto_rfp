# 03 — Deploy to dev and verify functional/perf/error behavior

**What to build:** Nothing new to code — this ticket deploys the change from ticket 02 to the dev environment and confirms zero functional regression plus the expected NAT/cold-start improvement.

Deploy using a full `pnpm deploy:dev` (not `deploy:dev:hotswap`), since Lambda VPC config is a full-resource-configuration change, not a code-only change. Deploy off-peak or after draining the document-pipeline Step Function queue, since removing the VPC config replaces the Lambda's ENI configuration and may briefly disrupt in-flight invocations.

After deploy, verify:

- Document indexing still works end-to-end: upload a document, watch the Step Function execution, confirm `IndexDocumentLambda` succeeds for every chunk, confirm Pinecone contains the resulting vectors.
- At least one chunk exercises the per-org Bedrock API key path (Secrets Manager lookup) and at least one exercises the default Bedrock key path.
- CloudWatch `INIT_DURATION` for `IndexDocumentLambda` is compared before vs. after — expect a noticeable drop (no more ENI attach).
- Sentry is watched for the document-pipeline for 24h post-deploy for any new category of network/DNS/connect error.
- The shared NAT Gateway's CloudWatch data-processing metric shows zero traffic attributable to `IndexDocumentLambda` after deploy.

If anything regresses, roll back by reverting the two files from ticket 02 and redeploying — this is a networking-only rollback with no data migration involved.

**Blocked by:** 02 — Remove VPC attachment from IndexDocumentLambda + CDK regression test.

**Status:** ready-for-agent

- [ ] Deployed to dev via full `pnpm deploy:dev` (not hotswap), off-peak or with the Step Function queue drained
- [ ] End-to-end document upload → chunking → indexing → Pinecone vectors confirmed working
- [ ] Per-org Bedrock API key (Secrets Manager) path confirmed working for at least one chunk
- [ ] Default Bedrock key path confirmed working for at least one chunk
- [ ] `IndexDocumentLambda` CloudWatch `INIT_DURATION` before/after comparison recorded, showing a drop
- [ ] Sentry monitored for the document-pipeline for 24h post-deploy with no new network/DNS/connect error categories
- [ ] Shared NAT Gateway CloudWatch data-processing metric confirmed at zero traffic attributable to `IndexDocumentLambda`
- [ ] Rollback plan (revert + redeploy) validated as available if any check above fails
