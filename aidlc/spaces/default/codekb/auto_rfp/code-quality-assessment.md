# Code Quality Assessment — AutoRFP (Solution-Plan Blast Radius)

> Grounded in the focused scan (intent `260821-solution-plan-versioning`). Quality claims apply to the scanned area; repo-wide coverage numbers were not measured.

## Testing

- **Tests are co-located and pervasive** in the scanned domain: 18 test files in `apps/functions/src/handlers/solution-plan/` alone (every handler has a `.test.ts` sibling); web feature has `__tests__/` under `hooks/`, `components/`, `lib/`.
- **Frameworks**: Jest 30 (functions), Jest 29 + React Testing Library (web), Vitest (core schemas), Playwright + Cypress (e2e — not analyzed in this run).
- **Convention**: tests mock middy and the AWS SDK before imports and exercise the exported business function directly, not the wrapped handler.
- **No coverage threshold observed** in the scanned configs — the org default (80% for `feature` scope) is aspirational, not enforced by tooling.
- **Gap**: no test asserts team preservation across re-init — relevant because re-init drops `planTeam` (see debt #1).

## CI/CD

Workflows found: `unit-tests.yml`, `deploy-infrastructure.yml`, `e2e-tests.yml`, `cypress.yml`, `claude-review.yml`, `lighthouse.yml`, `release.yml`. Linting: ESLint flat config in apps/web; **no root `.prettierrc`** observed (formatter defers to per-package/IDE defaults).

## Documentation Quality

**Exceptional for this domain**: the solution-plan and plan-team code carries ADR-referenced inline documentation (ADR-2 … ADR-14) and BR/FR requirement ids at decision points (e.g., ADR-7 versioned S3 keys, ADR-11 monotonic version, ADR-002 embedded planTeam). This makes design intent auditable directly in the code — a practice worth preserving in new versioning code.

## Technical Debt Signals (scanned area)

| # | Signal | Location | Impact on versioning work |
|---|---|---|---|
| 1 | **Re-init full-overwrite drops `planTeam`/`costSchedule`** (and `contentKey`) | `helpers/solution-plan-init.ts` lines 70–88 | Apparently contradicts BR1.2 (user-modified team survives regeneration); no team-preservation test exists. Versioning must treat re-init as a lossy write — strong argument for snapshotting BEFORE re-init |
| 2 | **Version number ≠ content version** | `helpers/plan-team.ts` (`writePlanTeam`) | Team-only bumps produce no S3 object; a version record cannot assume one HTML artifact per version number |
| 3 | **`getUserId` fallback reads JWT claims** | middleware/helpers | Fine for user id (the `orgId` rule is respected — `getOrgId` prefers header/query/body); just don't copy the pattern for orgId |
| 4 | **Legacy DTO names in the versioning precedent** | `packages/core/src/schemas/rfp-document-version.ts` (`CreateVersionDTOSchema`, `RevertVersionDTOSchema`) | New version entities MUST use the 5-type `<Entity>CreateRequest` pattern, not these names |
| 5 | **`queryBySkPrefix` does not paginate** | `helpers/db.ts` | Fine at ≤30 version records; copy the `KEEP_COUNT` pruning convention from the precedents |
| 6 | **`any` in `db.ts` generic helpers** | `helpers/db.ts` | Violates the no-`any` rule; contained to the primitives layer but touched by any new version helper |

## Attribution & Auditability Gaps

- The synthesis write path (SQS) carries **no user identity** — `GrillingRoundMessage` has only routing/run fields; only `updatedAt` is stamped.
- Team save/regenerate record **no user id** despite being authenticated REST calls.
- The schema's `createdByName`/`updatedByName` fields exist but **no solution-plan write populates them** (the precedent pattern in `rfp-document/revert-version.ts` shows how: `event.auth?.claims?.name || claims?.email`).
- Audit-log infrastructure exists (`auditMiddleware`/`setAuditContext`, `writeAuditLog`) but only `init` uses it in this domain.

## Overall Assessment

The scanned domain is in **good health**: consistent thin-handler/fat-helper structure, disciplined single-table access, strong test co-location, and unusually good inline design documentation. The debt is concentrated exactly where the versioning feature will operate — write-path asymmetries (lossy re-init, unattributed writes, version/content divergence) — so the feature should fix or explicitly design around items 1, 2, and the attribution gaps rather than inherit them.
