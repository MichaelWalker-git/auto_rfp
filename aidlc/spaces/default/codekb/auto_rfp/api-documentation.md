# API Documentation — AutoRFP

## REST API (API Gateway HTTP API v2)

- **Route definition pattern**: each domain has `packages/infra/api/routes/<domain>.routes.ts` returning a `DomainRoutes` object. **50 route files, ~308 route entries** total.
- **Registration invariant**: every domain is registered in two index-aligned arrays in `packages/infra/api/api-orchestrator-stack.ts` — `allDomains[]` and `domainStackNames[]`. A length mismatch **throws at synth**. Adding a domain = new `<domain>.routes.ts` + one entry in each array.
- **Handler wiring**: routes point at `apps/functions/src/handlers/...` via `lambdaEntry()` NodejsFunction bundling; default auth `COGNITO`.
- **Auth/RBAC**: Cognito JWT → middy stack `authContextMiddleware → orgMembershipMiddleware → requirePermission('<domain>:<action>') → httpErrorMiddleware`. Permission strings are a Zod enum in `packages/core/src/schemas/user.ts` (e.g. `proposal:create`, `pricing:read`) with per-role grant lists. New domains need new permission enum members + role grants.
- **Response contract**: `apiResponse(status, body)` from `@/helpers/api` on every REST handler; validation failures return 400 with Zod issues.
- **Tenancy contract**: `orgId` travels in the request (body for POST/PUT/PATCH, query for GET/DELETE, or path) — never derived from the token.

### Solution Plan endpoints (`solution-plan.routes.ts`, read in full)

| Method & path | Purpose |
|---|---|
| `POST /solution-plan/init` | Start grilling loop (enqueues SQS job, status `GRILLING`) |
| `GET /solution-plan/get` | Fetch plan metadata item (status, version, `isStale`, `costSchedule`) |
| `GET /solution-plan/transcript` | Fetch grilling Q&A transcript |
| `PATCH /solution-plan/update` | Save edited plan (HTML to S3, version bump) |
| `GET /solution-plan/html-content` | Fetch the S3-stored HTML body |

### RFP document generation

- `POST /rfp-document/generate` (`generate-document.ts`) — validates type, enforces the **solution-plan gate** (plan must be READY unless type ∈ `SOLUTION_PLAN_GATE_EXEMPT_DOCUMENT_TYPES`), creates placeholder doc `GENERATING`, enqueues SQS job. `TEAM_QUALIFICATIONS` is content-based, AI-generatable, and gated.
- Create/other CRUD in `handlers/rfp-document/` (note: `create-rfp-document.ts` is the convention anti-exemplar — see code-structure.md).

## Async & Event-Driven Surfaces

### SQS workers (not API routes)
| Worker | Trigger | Function |
|---|---|---|
| `generate-document-worker` | doc-gen queue | context assembly → Bedrock → `validateGeneratedContent` → 3 retries (30/60/120 s) → READY or FAILED + notification |
| `solution-plan-worker` | solution-plan queue | Griller/Synthesizer loop → S3 HTML + DynamoDB item |
| `extraction-worker` | extraction queue | dispatches on `targetType ∈ {PAST_PERFORMANCE, LABOR_RATE, BOM_ITEM}` → DRAFT records + approve flow |
| compliance-review worker | compliance queue | (skimmed only) |
| exec-brief queue | brief queue | section-based brief generation (skimmed only) |

### Step Functions
- `answer-generation-step-function` — RAG answer pipeline
- `document-pipeline-step-function` — upload → text extraction → chunking → Pinecone indexing
- `question-pipeline-step-function` — question extraction

### WebSocket API
- `collaboration-websocket-stack.ts` — real-time collaboration. WebSocket handlers return plain `{ statusCode, body }` (not `apiResponse`).

## External Integrations

| Integration | Mechanism | Notes |
|---|---|---|
| Bedrock | **HTTPS only** via `helpers/bedrock-http-client.ts`, API key from SSM | never `@aws-sdk/client-bedrock-runtime` |
| Pinecone | `@pinecone-database/pinecone` ^6.1.4 | org-namespaced, metadata-filtered (e.g. `type: 'past_project'`); Titan embeddings |
| Cognito | Amplify (web) + JWT authorizer (API) | user records dual-written to DynamoDB |
| SAM.gov / HigherGov | HTTP integrations | opportunity sourcing |
| Google Drive | HTTP integration | document import |
| Linear | HTTP integration | ticketing |
| Sentry | `@sentry/serverless` (Lambda), `@sentry/nextjs` (web) | `withSentryLambda` on all REST handlers |

## Internal Contract Notes (for downstream design)

- The solution plan item is the natural attachment point for structured, server-validated data: `costSchedule` (`SolutionPlanCostScheduleSchema`, nullable, server-recomputed totals) already rides alongside the S3 HTML body — the precedent a team-definition field would follow (observation, not design).
- Past-performance matching consumes exec brief `sections.requirements.data` (fallback: summary) — the same input a person-matching flow would consume.
- AI extraction jobs (`extraction-job.ts`) carry a `targetType` discriminator; extending extraction means a new target type + worker branch. Affirmed project rule: CV extraction will use **direct import**, skipping the existing draft-review step.
