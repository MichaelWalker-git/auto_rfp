# Dependencies — AutoRFP

## Internal Cross-Package Dependencies

```
@auto-rfp/core  ──►  @auto-rfp/web
                ──►  @auto-rfp/functions
                ──►  @auto-rfp/infra
@auto-rfp/functions (sources)  ──bundled by──►  @auto-rfp/infra (lambdaEntry() NodejsFunction paths)
```

- **Build order is hard**: `packages/core` must be built (tsup, ESM+CJS) before `apps/web`, `apps/functions`, or `packages/infra` can type-check/build. After any core schema change, rebuild core first.
- `packages/infra` does not depend on a built functions artifact — it **bundles `apps/functions/src` handler sources directly** via `lambdaEntry()` at synth/deploy time.
- `apps/functions/src/constants/common.ts` re-exports `PK_NAME`/`SK_NAME` from `@auto-rfp/core` (`packages/core/src/constants.ts` is the single source of truth for the single-table key names).
- Caution: `packages/infra/lib/` contains **stale committed compiled output** (`.js`/`.d.ts`) shadowing the real `.ts` stack sources one level up (`packages/infra/*.ts`, `packages/infra/api/`) — navigate to the `.ts` sources, not `lib/`.

## External Service Dependencies

| Service | Access path | Coupling notes |
|---|---|---|
| AWS Bedrock | **HTTP only** via `apps/functions/src/helpers/bedrock-http-client.ts`; API key from SSM | Hard rule: never import `@aws-sdk/client-bedrock-runtime`. All AI generation (documents, solution plan, answers, extraction) depends on this client. |
| Pinecone | `@pinecone-database/pinecone` ^6.1.4 | org-namespaced indexes, metadata-filtered queries (`type: 'past_project'` etc.); Titan embeddings. Semantic retrieval for RAG, past-performance matching, KB search. |
| Amazon Cognito | Amplify (web) + JWT authorizer (API) + `@aws-sdk/client-cognito-identity-provider` | users dual-written to Cognito and DynamoDB |
| SAM.gov | HTTP integration | opportunity sourcing |
| HigherGov | HTTP integration | opportunity sourcing |
| Google Drive | HTTP integration | document import |
| Linear | HTTP integration | ticketing |
| Sentry | `@sentry/serverless` (functions), `@sentry/nextjs` (web) | `withSentryLambda` on all REST handlers |

## AWS Managed-Service Dependencies

- **DynamoDB** — single shared table (`partition_key`/`sort_key`), GSIs; all access through `helpers/db.ts`.
- **S3** — uploaded files, extracted text, chunk storage, solution-plan HTML bodies, generated documents.
- **SQS** — document generation, solution-plan grilling, extraction, compliance-review, exec-brief queues (each with worker Lambdas).
- **Step Functions** — answer-generation, document-pipeline, question-pipeline.
- **API Gateway** — HTTP API v2 (REST) + WebSocket API (collaboration).
- **SSM Parameter Store** — Bedrock API key.
- **Amplify Hosting** — web frontend deployment.

## Dependency Risks (observed)

- Everything AI flows through one Bedrock HTTP client and one Pinecone client — single choke points (also single places to instrument).
- Infra bundling of functions sources means handler-level type errors surface at CDK synth/deploy, not at an infra package build of its own sources.
- Version skew: Zod ^3.24 vs ^3.25 and Vitest ^2 vs ^4 across packages (minor; assumption: benign, not verified).
