# Code Structure — AutoRFP

## Monorepo Layout

pnpm workspaces (pnpm 10.10.0, Node >= 20), ESM everywhere, TypeScript strict.

```
auto_rfp/
├── apps/
│   ├── web/                 # @auto-rfp/web — Next.js App Router frontend
│   │   ├── app/             # Pages/layouts; route groups (auth), (dashboard); org pages at app/organizations/[orgId]/
│   │   ├── features/        # 18 FSD feature modules (incl. solution-plan)
│   │   ├── components/      # Shadcn UI primitives (ui/) + older non-FSD domains (e.g. pricing/, opportunities/)
│   │   ├── layouts/         # sidebar-layout (static org nav array, lines 134–149)
│   │   ├── lib/hooks/       # shared SWR hooks (useApi, apiMutate, useAuth, useHealth)
│   │   └── context/         # auth, organization providers
│   ├── functions/           # @auto-rfp/functions — Lambda handlers (Node 20, ESM)
│   │   └── src/
│   │       ├── handlers/    # 55 domain dirs of thin handlers
│   │       ├── helpers/     # ~150 files of business logic, db, AI integration
│   │       ├── middleware/  # rbac-middleware.ts (AuthedEvent), audit-middleware.ts
│   │       ├── constants/   # PK constants; common.ts re-exports PK_NAME/SK_NAME from core
│   │       └── types/       # DynamoDB item types (legacy location; DBItem now belongs in core)
├── packages/
│   ├── core/                # @auto-rfp/core — ~80 Zod schema files + constants.ts; tsup → ESM+CJS
│   └── infra/               # @auto-rfp/infra — CDK app; real sources at *.ts and api/; lib/ = STALE compiled output
├── evals/                   # AI eval suites (executive-brief, question_generation)
├── scripts/                 # utilities
└── docs/                    # 46 implementation docs + "team defenition/task" (initiative problem statement)
```

## Code Patterns (verified in scanned code)

### Backend — thin handler + helpers
- Handler: parse event → `const { success, data, error } = Schema.safeParse(raw)` → helper call → `apiResponse(status, body)`; wrapped `withSentryLambda(middy(...))` with stack `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware`.
- `orgId` sourced from body/query/path — never `event.auth`/JWT.
- All DynamoDB via `helpers/db.ts` (`createItem`, `getItem`, `queryBySkPrefix`, `queryByIndex`, …); SK strings via builder functions, PK constants from `src/constants/`.
- Bedrock only via `helpers/bedrock-http-client.ts` (HTTPS, API key from SSM).
- Path alias `@/*` → `src/*`.

### Frontend — Feature-Sliced Design
- `features/<domain>/{components,hooks,lib,index.ts}` with barrel exports; pages import from `@/features/<domain>` only.
- SWR + `authenticatedFetcher` for data; `nuqs` for URL state; react-hook-form + zodResolver with `z.input<>`; Skeleton loading (never spinners); Shadcn UI only.
- **Exemplar**: `apps/web/features/solution-plan/` — hooks (`useSolutionPlan`, `useSolutionPlanHtmlContent`, `useUpdateSolutionPlan`, `useInitSolutionPlan`, `useSolutionPlanGate`, `useSolutionPlanActions`), `SolutionPlanPanel` (embedded in `OpportunityView.tsx:305`), full-page TipTap editor at `.../opportunities/[oppId]/solution-plan/edit`, every hook/component tested.
- **Older, non-FSD pattern**: pricing UI lives under `apps/web/components/pricing/` (`LaborRateManager`, `StaffingPlanBuilder`, `PendingDraftsSection`), used by `app/organizations/[orgId]/pricing/` — do not copy this layout for new features.

### Shared types — the 5-type entity pattern
Every stored entity should expose `<Entity>CreateRequestSchema` / `UpdateRequestSchema` / `ItemSchema` / `DBItemSchema` (`[PK_NAME]`/`[SK_NAME]`) / `ListItemSchema` in `packages/core/src/schemas/<entity>.ts`, types via `z.infer<>`, barrel-exported.

**Known violations** (from scan):
- 21 core schema files still export legacy `*DTOSchema` names (e.g. `CreateRFPDocumentDTOSchema`, `UpdateKnowledgeBaseSchema`).
- `rfp-document.ts`, `document.ts`, `kb.ts` do not follow the 5-type pattern.
- `apps/functions/src/handlers/rfp-document/create-rfp-document.ts` builds its item as `Record<string, any>`, constructs the SK inline (`` `${projectId}#${opportunityId}#${documentId}` ``) instead of via an SK builder, and sets `status: 'NEW'` which is not in `RFPDocumentStatusSchema` (hypothesis: dead/incorrect branch — generation sets `GENERATING` elsewhere). This file is the anti-exemplar.

## File Classification

| Class | Location | Notes |
|---|---|---|
| REST handlers | `apps/functions/src/handlers/<domain>/*.ts` | thin, middy-wrapped |
| Async workers | same handler dirs (e.g. `rfp-document/generate-document-worker.ts`, `solution-plan/solution-plan-worker.ts`, `extraction/extraction-worker.ts`) | SQS-driven, no API route |
| Business logic | `apps/functions/src/helpers/*.ts` | incl. god-files `document-prompts.ts` (1,407 lines), `generate-document-worker.ts` helper (1,527 lines) |
| Domain schemas | `packages/core/src/schemas/*.ts` | ~80 files |
| Route definitions | `packages/infra/api/routes/*.routes.ts` | 50 files, ~308 entries |
| CDK stacks | `packages/infra/*.ts`, `packages/infra/api/` | `packages/infra/lib/` is stale compiled `.js`/`.d.ts` — ignore |
| Tests | co-located `*.test.ts`; web tests in `__tests__/` subdirs | 219 functions / 83 web / 30 core / 2 infra |
| Eval suites | `evals/` | executive-brief, question_generation |

## Navigation & Feature Gating Structure

- Org-level navigation is a **static array** in `apps/web/layouts/sidebar-layout/sidebar-layout.tsx:134–149`; adding an org page (e.g. the planned employee pool) means adding an entry there.
- Existing "Org Members" entry (`/organizations/[orgId]/team` → `TeamContent`) is **platform user management** — distinct from the planned employee pool page.
- KB nav label is "Org Documents" (`sidebar-layout.tsx:139`).
- Solution-plan feature gated on org flag `enableSolutionPlan` (`packages/core/src/schemas/organization.ts:87`).
