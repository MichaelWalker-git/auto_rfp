# 08 — Thread `orgId` through async pipelines & workers (absorbs P3 spike)

**What to build:** Every async Bedrock caller — step-function task workers and SQS workers — runs
on the org's identity, end to end. All three pipelines already carry `orgId` in their payloads
(confirmed by the P3 spike), so the risk here is not net-new plumbing but **verification**: that
each Bedrock-invoking worker actually reads `event.orgId` and passes it into the invoke, rather
than silently relying on the "optional / look it up from the project" fallback that some pipeline
steps allow. Where a worker doesn't reliably receive `orgId`, plumb it through the task/message
payload.

**Blocked by:** 05 — expand `orgId` parameter.

**Status:** ready-for-agent

- [ ] For each Bedrock-invoking worker in answer-generation, question-pipeline, document-pipeline,
      exec-brief-worker, and generate-document-worker: confirm `orgId` arrives in the task/SQS
      payload and is read explicitly, then passed into the `orgId`-bearing invoke — no reliance on
      the optional project-lookup fallback for the org's identity at the Bedrock step.
- [ ] Any step whose payload does not reliably carry `orgId` to its Bedrock worker gets payload
      plumbing (step-function task input / SQS message body) so the worker receives it.
- [ ] The spike's findings (which workers already had `orgId`, which needed plumbing) are recorded
      briefly in the ticket/PR so the propagation scope is auditable.
- [ ] Worker + step-function tests updated/added to assert `orgId` reaches the Bedrock invoke.
- [ ] `apps/functions` and `packages/infra` build; touched tests pass (CI green — param still
      optional).
