# 12 — IAM: Secrets Manager grant + retire the shared SSM param

**What to build:** Bring IAM and infrastructure in line with per-org key storage: every
Bedrock-invoking Lambda — including the step-function task workers and SQS workers that today have
only a narrow SSM grant on the shared param — can read `bedrock-api-key-*` from Secrets Manager,
and the shared `/auto-rfp/bedrock/api-key` param and its grants are gone. After this there is a
single, auditable key path with no dead SSM references.

> ⚠️ Deploy alongside 09 and only after the P1 dev/test/CI key provisioning prerequisite is done
> and verified (see README).

**Blocked by:** 09 — per-org resolution reads from Secrets Manager.

**Status:** ready-for-agent

- [ ] Every Bedrock-invoking Lambda (REST handlers, step-function task workers, SQS workers) has
      `secretsmanager:GetSecretValue` on `bedrock-api-key-*` — confirm the common Lambda role's
      existing `*-api-key-*` grant covers the workers, and add it where a worker's role doesn't.
- [ ] The narrow per-Lambda SSM grants on `.../parameter/auto-rfp/bedrock/api-key` in the three
      step-function stacks are removed.
- [ ] The shared SSM param resource and the `BEDROCK_API_KEY_SSM_PARAM` env var are removed from the
      CDK stacks; no code or config still references the shared param.
- [ ] `packages/infra` builds; infra tests pass; `cdk-nag` clean (any suppression documented).
