# Code Structure — AutoRFP

> Grounded in the focused solution-plan scan (intent `260821-solution-plan-versioning`). Directory layout outside the scanned area follows the repo conventions but was not verified deeply in this run.

## Monorepo Organization

```
auto_rfp/                          # pnpm workspaces
├── apps/
│   ├── web/                       # @auto-rfp/web — Next.js App Router (Next 16.0.10)
│   │   └── features/solution-plan/
│   │       ├── components/        # SolutionPlanEditorPage, SolutionPlanPanel, TeamDefinitionSection, ...
│   │       ├── hooks/             # useSolutionPlan, useUpdateSolutionPlan, usePlanTeam, ... (+__tests__)
│   │       └── lib/               # swr.ts (keys/fetchers), gating.ts, save-errors.ts, status.ts
│   └── functions/                 # @auto-rfp/functions — Lambda (Node 20, ESM)
│       └── src/
│           ├── handlers/solution-plan/   # 9 handlers + 18 co-located test files
│           ├── handlers/rfp-document/    # incl. version endpoints (revert-version.ts etc.)
│           ├── helpers/                  # ALL business logic (solution-plan.ts, plan-team.ts, db.ts, ...)
│           ├── constants/                # PK constants (solution-plan.ts, common.ts re-exports PK_NAME/SK_NAME)
│           ├── middleware/               # rbac-middleware.ts, audit-middleware.ts
│           └── types/                    # DynamoDB item types (being migrated to core DBItem schemas)
├── packages/
│   ├── core/                      # @auto-rfp/core — Zod schemas, tsup ESM+CJS, built FIRST
│   │   └── src/schemas/           # solution-plan.ts, rfp-document-version.ts, ... (export * barrel)
│   └── infra/                     # @auto-rfp/infra — CDK
│       └── api/
│           ├── routes/            # solution-plan.routes.ts, rfp-document.routes.ts, ...
│           └── api-orchestrator-stack.ts  # route registration + SQS queue/DLQ/worker wiring
├── evals/                         # AI evaluation suites (not scanned)
└── scripts/                       # utilities (not scanned)
```

## File Classification (scanned area)

| Class | Examples | Role |
|---|---|---|
| Zod entity schemas | `packages/core/src/schemas/solution-plan.ts`, `rfp-document-version.ts` | Domain types via `z.infer<>`; 5-type pattern |
| Constants | `apps/functions/src/constants/solution-plan.ts`, `packages/core/src/constants.ts` | PK strings, `PK_NAME`/`SK_NAME` |
| DB primitives | `apps/functions/src/helpers/db.ts` | `createItem`, `putItem`, SET-only `updateItem` + conditions, `queryBySkPrefix`/`queryAllBySkPrefix`, `batchDeleteItems`, `deleteAllBySkPrefix`, retry/backoff |
| Domain helpers | `helpers/solution-plan.ts` (SK builders, CRUD, S3 HTML, staleness), `solution-plan-init.ts`, `solution-plan-worker.ts`, `plan-team.ts`, `solution-plan-gate.ts`, `rfp-document-version.ts`, `team-qualifications-context.ts` | All business logic |
| Thin handlers | `handlers/solution-plan/*.ts` | parse → `safeParse` (destructured) → helper → `apiResponse()` |
| Async workers | `handlers/solution-plan/solution-plan-worker.ts` (SQS), `helpers/generate-document-worker.ts` | Event-driven flows |
| CDK routes/stacks | `api/routes/solution-plan.routes.ts`, `api-orchestrator-stack.ts` | Route registration, queue/DLQ/Lambda wiring via `lambdaEntry()` |
| Web hooks/components | `features/solution-plan/hooks/*`, `components/*` | Feature-Sliced Design; SWR + `authenticatedFetcher` |
| Co-located tests | `*.test.ts` next to source (18 in `handlers/solution-plan/`), `__tests__/` in web feature | Jest 30 / Jest 29+RTL / Vitest |

## Code Patterns

### Thin handler pattern (every REST handler)
1. Parse event (body/query/path)
2. `const { success, data, error } = Schema.safeParse(raw)` — always destructured
3. `orgId` from body/query/path (never JWT); `getUserId(event)` for user id; display name via `event.auth?.claims?.name || claims?.email` (pattern in `rfp-document/revert-version.ts`)
4. Call helper; return `apiResponse(status, body)`
5. Middy stack `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware` (+ `auditMiddleware` on init); wrapped in `withSentryLambda`

### 5-type Zod entity pattern
Every stored entity exposes `<Entity>CreateRequestSchema`, `<Entity>UpdateRequestSchema`, `<Entity>ItemSchema` (no DB keys), `<Entity>DBItemSchema` (`[PK_NAME]`/`[SK_NAME]`), `<Entity>ListItemSchema`. `SolutionPlanItemSchema` follows this; the versioning precedent (`rfp-document-version.ts`) still carries legacy `CreateVersionDTOSchema`/`RevertVersionDTOSchema` names — do not copy those names.

### SK builders — never manual strings
- Plan: `buildSolutionPlanSk` → `{orgId}#{projectId}#{opportunityId}` (one item per opportunity)
- Transcript: `{solutionPlanId}#{round:3pad}#{ts}#{messageId}`
- Version precedent: `{projectId}#{opportunityId}#{documentId}#{versionNumber:6pad}`
- S3 HTML: `buildSolutionPlanHtmlKey` → `{orgId}/{projectId}/{opportunityId}/solution-plan/v{version}/solution-plan.html`

### Frontend patterns
- `'use client'` hooks with SWR (`useSolutionPlan` polls 3s while status is running); keys/fetchers centralized in `lib/swr.ts`
- `SolutionPlanEditorPage.tsx` (TipTap) tracks `editorVersion` with a monotonic-forward guard
- Components presentation-only; logic in hooks; barrel export `index.ts`

### AI integration
Bedrock ONLY via `helpers/bedrock-http-client.ts` (HTTP, SSM-cached API key); `invokeClaudeJson` in `executive-opportunity-brief.ts`. Never `@aws-sdk/client-bedrock-runtime`.

## Identifier Conventions

- `ulid` for run ids (`runId`), `uuid` for entity ids
- `updateItem` auto-stamps `updatedAt`; `createdBy`/`updatedBy` set on REST writes that have identity (init, content edit) — team writes and the SQS synthesis write do not record a user
