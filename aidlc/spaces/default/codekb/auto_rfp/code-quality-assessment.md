# Code Quality Assessment — AutoRFP

## Test Coverage

| Package | Test files | Framework | Notes |
|---|---|---|---|
| `apps/functions` | 219 (co-located `*.test.ts`) | Jest | no coverage threshold found in config |
| `apps/web` | 83 (`__tests__/` subdirs) | Jest + RTL; Playwright e2e; Cypress workflow | global threshold 50% branches/functions/lines/statements |
| `packages/core` | 30 | Vitest | schema tests |
| `packages/infra` | 2 | Jest | thin CDK coverage |

Testing conventions: test the exported business function directly (not the middy-wrapped handler); mock middy and AWS SDK before imports; co-located tests. The solution-plan frontend feature is fully tested (every hook and component) — the quality high-water mark.

## Linting & Static Gates

- ESLint flat config exists **only in `apps/web`** (`eslint.config.mjs`). `apps/functions` has **no ESLint config** — `tsc` type-checking is the only static gate there, which is how 108 `as any` occurrences survive despite the repo-wide "no any" rule.
- TypeScript strict mode in all packages.

## CI/CD

`.github/workflows/`: `unit-tests.yml` (PR/push to main/develop/production; shared core build then per-package tests), `deploy-infrastructure.yml`, `e2e-tests.yml`, `cypress.yml`, `lighthouse.yml`, `claude-review.yml`, `release.yml`.

Branch model: feature → `develop` (dev deploy) → `main` (test) → `production` (release workflow). Note: this differs from the org-level trunk-based default; the repo's own convention docs are authoritative for day-to-day work here.

## Documentation Quality

- Root `README.md` + an extensive `.claude/rules/` convention set (entity pattern, backend/frontend architecture, DynamoDB, testing).
- 46 implementation docs in `docs/` (e.g. `PAST-PERFORMANCE-MATCHING.md`, `PLAN-COST-SCHEDULE-IMPLEMENTATION.md`); `docs/team defenition/task` is the current initiative's problem statement.
- Helpers/schemas carry high-quality doc comments with inline ADR references (ADR-3…ADR-14) — unusually good decision traceability at code level.

## Technical Debt Signals

1. **108 `as any` in `apps/functions/src` non-test code** (e.g. `getSignedUrl(s3Client as any, ...)` in `create-rfp-document.ts:129`) — direct violation of the "no any" rule; enabled by the missing functions ESLint config.
2. **21 legacy DTO schema files** in `packages/core/src/schemas/` still export deprecated `*DTOSchema` names (`CreateRFPDocumentDTOSchema`, `UpdateKnowledgeBaseSchema`, kb/document schemas); `rfp-document.ts`, `document.ts`, `kb.ts` do not follow the 5-type entity pattern.
3. **`create-rfp-document.ts` convention violations**: item built as `Record<string, any>`, SK constructed inline (`` `${projectId}#${opportunityId}#${documentId}` ``) instead of via an SK builder, and sets `status: 'NEW'` which is not a member of `RFPDocumentStatusSchema` (hypothesis: dead/incorrect branch — generation sets `GENERATING` elsewhere). Anti-exemplar for new code.
4. **Stale compiled output committed under `packages/infra/lib/`** (`.js`/`.d.ts` shadowing the real `.ts` sources at `packages/infra/*.ts` and `packages/infra/api/`) — navigation hazard and drift-prone.
5. **God-files in the generation path**: `document-prompts.ts` (1,407 lines) and the `generate-document-worker.ts` helper (1,527 lines) — concentrated in exactly the area the team-definition initiative must modify; change risk is elevated there.
6. Older UI pattern: pricing components under `apps/web/components/pricing/` instead of `features/` (FSD) — do not replicate.
7. Low marker debt otherwise: only 5 TODO/FIXME/HACK markers across scanned source.

## Overall Assessment

Codebase health is **good-to-strong where conventions are enforced** (core schemas, solution-plan feature, middleware/db discipline, CI breadth) and **weakest in the oldest paths** (rfp-document creation, kb/document schemas, pricing UI) — which unfortunately overlap the team-definition initiative's blast radius (document generation, pricing/staffing, KB). New work should copy `features/solution-plan/` and the 5-type pattern, and treat the god-file helpers as refactor-or-extend-carefully zones. Assumption: functions-package runtime behavior is well-covered by its 219 test files, but with no coverage threshold configured this is unverified.
