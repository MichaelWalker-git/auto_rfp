# Team-Level Rules

> This team's affirmed practices and corrections. Loaded after `org.md` as
> strict-additive guidance; contradictions with broader policy are rejected.
> Populated by the practices-discovery affirmation gate. Edit at the gate,
> not directly.

## Way of Working

We use a **three-branch deployment strategy** with `develop` → `main` → `production`:

- **develop** — Main development branch. Feature branches are created from and merged back to `develop` via pull requests. Merging to `develop` triggers automated deployment to the dev environment.
- **main** — Test environment branch. Changes are promoted from `develop` to `main` via pull request for test environment deployment.
- **production** — Customer-facing branch. Updated only via the manual Release workflow (`.github/workflows/release.yml`). The workflow validates, runs tests (on `packages/core` and `apps/web` only), merges `develop` into `production`, creates a git tag, and generates a GitHub Release.

**Feature branch lifecycle**: create from `develop` → PR to `develop` → merge (squash or merge commit) → automated dev deployment.

**For Construction worktrees**: the worktree base branch is `develop` and the merge target is `develop`. This supersedes the org-level trunk-based default (`main` as base/target) for this team.

## Walking Skeleton

We do not use the walking-skeleton Bolt pattern. Feature work begins directly with implementation — the first piece of work runs like any other, with no skeleton ceremony.

## Testing Posture

We treat **tests as a first-class deliverable**:

- **Co-located tests**: Every handler, helper, and component has a corresponding test file in the same directory (`create-foo.ts` → `create-foo.test.ts`). This practice is pervasive across the codebase (9 handlers with 9 co-located test files in `apps/functions/src/handlers/solution-plan/` alone).
- **Frameworks**: Jest 30 (backend), Jest 29 + React Testing Library (frontend), Vitest (core schemas), Playwright + Cypress (e2e).
- **Coverage target**: 80% line coverage is our aspirational goal for `feature` scope work. This is not enforced by CI tooling (`apps/web` has a dormant 50% threshold that CI never runs; `apps/functions` disables coverage collection explicitly; `packages/core` has a reporter but no thresholds). Tests are required, coverage floors are guidance.
- **Test philosophy**: Tests exercise the exported business function directly, not the middy-wrapped handler. Mocks (AWS SDK, middy) are set up before imports in test files.
- **Per-handler test categories**: Every new handler must include tests for happy path, validation (400 with error details), not-found (404), guard clauses (business rules), DynamoDB call assertions (correct table/keys/expressions), and edge cases (optional fields, empty arrays).
- **CI gating**: Unit tests run in parallel on PRs and pushes to `develop`/`main`/`production`. The `unit-tests.yml` workflow tests `packages/core`, `apps/functions`, `apps/web` (with `--passWithNoTests`), and `packages/infra` (with `--passWithNoTests`). Lint runs only on `apps/web` (`lint-web` job; other packages are not linted in CI). E2E tests (Playwright) are path-filtered to `apps/web` and `packages/core` changes only — backend-only changes receive no e2e gate. No `tsc --noEmit` type-check job exists in CI (type safety relies on Jest/Vitest and local tsc builds).

**Known gaps**:
- No test coverage for data preservation across destructive operations (e.g., re-init drops `planTeam` — tracked in code quality assessment).
- The production Release workflow tests only `packages/core` and `apps/web` (the latter with `--passWithNoTests`) — `apps/functions` and `packages/infra` tests are not executed on the release path. Develop and main CI coverage is accepted as sufficient for this gap.

## Deployment

Day-to-day work deploys and is verified **only on the dev environment** (merges to `develop`). The `main` → test and `production` → customer-facing paths exist in the repository and workflows but sit outside the affirmed routine practice.

**Infrastructure**: All AWS CDK stacks. Multi-stage support via `--context stage=<env>` flag. OIDC authentication to AWS (no long-lived credentials in CI). Infrastructure changes use `cdk-nag` (`AwsSolutionsChecks`) at synth time with reason-documented suppressions in `packages/infra/cdk-nag-suppressions.ts`.

## Code Style

We defer to **project-level tooling configurations**:

- **Package manager**: pnpm (workspaces monorepo)
- **Formatter**: No formatter configuration exists anywhere in the workspace. We rely on IDE-default formatting (no Prettier, no Black, no gofmt config).
- **Linter**: ESLint flat config (`eslint.config.mjs`) in `apps/web` only. CI runs `pnpm lint` (which resolves to the web package alone); `apps/functions`, `packages/core`, and `packages/infra` are not linted in CI. Their style gate is TypeScript strict mode plus tests.
- **TypeScript**: Strict mode enabled across all packages. `moduleResolution: "bundler"` (no `.js` extensions in import paths).
- **Naming conventions**:
  - Functions: `const` arrow functions (except Next.js `export default function` page/layout requirement)
  - Event handlers: prefixed with `handle` (e.g., `handleClick`, `handleSubmit`)
  - Booleans: auxiliary verbs (`isLoading`, `hasError`, `canSubmit`)
  - Avoid TypeScript enums — use `z.enum([...])` or const maps instead
- **UI patterns**: Create/edit pages are separate routes for full-page workflows (e.g., `/users/create`, `/users/[id]/edit`). Inline forms and modal dialogs are acceptable where the feature already uses them (e.g., pricing).
- **Node version**: 20+ (Lambda runtime, CI)
- **Module system**: ESM (`"type": "module"`) everywhere

**Import conventions**:
- Path aliases: `@/*` in `apps/functions` (resolves under `src/`) and `apps/web` (resolves at app root)
- Barrel exports: `features/<feature>/index.ts` exports all public components/hooks
- Never import from internal feature paths — use the barrel
## Forbidden

<!-- Team-specific forbidden patterns -->

## Mandated

<!-- Team-specific mandates -->

## Corrections

<!-- Self-learning loop appends here. -->
