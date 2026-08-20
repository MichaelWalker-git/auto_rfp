# Build Instructions — Team Definition (all units)

How to build the monorepo with the four Team Definition units (employee-pool, cv-import, plan-team, team-qualifications) in place. Inputs: the per-unit `code-generation/code-summary.md`, `code-generation-plan.md`, and `unit-test-instructions.md` under `construction/<unit>/`.

## Prerequisites

- Node.js 20+, pnpm 9+ (`corepack enable` or global install)
- No AWS credentials needed for build or unit tests — all AWS SDK calls are mocked in tests

## Dependency Installation

```bash
# From the monorepo root
pnpm install
```

## Environment Setup

- Build and unit tests need no `.env` — test files set `DB_TABLE_NAME`, `DOCUMENTS_BUCKET`, `REGION` themselves.
- Local dev server (`pnpm dev`) uses `apps/web/.env.local` per `apps/web/.env.example` (unchanged by this feature).
- Deployed Lambdas: no new environment variables were introduced. The generate-document handler now transitively reads `DOCUMENTS_BUCKET` at module load; that variable is already in the API stack's `commonEnv`, so no infrastructure change is required.

## Build Order & Commands

`packages/core` MUST build first — both apps import `@auto-rfp/core`:

```bash
# 1. Core schemas (tsup → ESM + CJS; runs its Vitest suite is separate)
pnpm --filter @auto-rfp/core build

# 2. Lambda functions (tsc — type-checks the backend)
pnpm --filter @auto-rfp/functions build

# 3. CDK infrastructure (tsc)
pnpm --filter @auto-rfp/infra build

# 4. Web type-check (no emit; full Next build runs in CI/Amplify)
cd apps/web && npx tsc --noEmit
```

## Build Verification

- Steps 1–3 exit 0 with no TypeScript errors.
- Step 4: expect ONLY the pre-existing failures (test-file matcher noise from the jest-dom type setup, and `components/win-rate/WinRateCard.tsx` TS2305) — zero errors in any file the four units touched.

## Troubleshooting

- **`Cannot find module '@auto-rfp/core'` in apps/** — `packages/core` was not rebuilt after a schema change; re-run step 1.
- **Stale types after editing a core schema** — tsup emits `dist/`; IDE TS servers may cache. Re-run step 1, then restart the TS server.
- **`Module not found` on `.claude/tools` invocations after `cd`** — workflow tooling issue, not a build issue; run tools from the repo root.
- **Jest flag mismatch** — `apps/functions` (newer Jest) uses `--testPathPatterns`; `apps/web` uses `--testPathPattern` (singular). The per-unit instruction files reflect this; if a command errors on the flag name, switch to the other form.
