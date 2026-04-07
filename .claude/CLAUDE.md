# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AutoRFP** is an AI-powered RFP response automation platform for government contractors. Core capabilities: RFP document processing, AI answer generation (RAG), executive briefs, proposal generation, SAM.gov integration, and knowledge base management.

## Monorepo Structure

```
auto_rfp/                    # pnpm workspaces monorepo
├── apps/
│   ├── web/                 # Next.js App Router frontend (Tailwind 4, Shadcn UI, SWR)
│   └── functions/           # AWS Lambda handlers (Node.js 20, ESM)
├── packages/
│   ├── core/                # Shared Zod schemas & inferred TypeScript types (tsup, vitest)
│   └── infra/               # AWS CDK stacks (API Gateway, DynamoDB, Cognito, S3, etc.)
└── scripts/                 # Utility scripts
```

## Commands

All commands use `pnpm`. Run from the monorepo root unless noted.

```bash
# Root-level
pnpm build                   # Build all packages
pnpm dev                     # Start web dev server
pnpm test                    # Run all tests
pnpm lint                    # Lint all packages

# Core schemas (packages/core)
cd packages/core
pnpm build                   # Build with tsup (required before web/functions can import)
pnpm test                    # Run vitest schema tests

# Lambda functions (apps/functions)
cd apps/functions
pnpm test                    # Run all Jest tests
pnpm test -- --testPathPattern=handlers/answer   # Run tests for a specific domain
pnpm test -- path/to/file.test.ts                # Run a single test file

# Web app (apps/web)
cd apps/web
pnpm dev                     # Dev server (port 3000)
pnpm build                   # Production build
pnpm test                    # Jest unit/component tests
pnpm test:e2e                # Playwright e2e tests
pnpm test:e2e:ui             # Playwright with UI
pnpm lint                    # ESLint

# Infrastructure (packages/infra)
cd packages/infra
pnpm test                    # CDK/Jest tests

# Deployments (from root)
pnpm deploy:dev              # Deploy all CDK stacks to dev
pnpm deploy:dev:hotswap      # Hotswap deploy (faster for Lambda changes)
pnpm deploy:dev:api          # Deploy only API stack to dev
```

### Build Order

`packages/core` must be built first — both `apps/web` and `apps/functions` depend on it:
```bash
cd packages/core && pnpm build   # Always rebuild after changing schemas
```

### Type Checking

```bash
cd apps/functions && pnpm build  # tsc (checks types)
cd apps/web && npx tsc --noEmit  # Type-check without emitting
cd packages/infra && pnpm build  # tsc
```

## Architecture

### Backend (apps/functions)

Lambda handlers are organized by domain in `src/handlers/<domain>/`. Each handler follows a thin pattern:
1. Parse event → 2. Validate with Zod (destructure `safeParse`) → 3. Call helper → 4. Return `apiResponse()`

Key directories:
- `src/handlers/` — Thin Lambda handlers grouped by domain (~30 domains)
- `src/helpers/` — Business logic, DynamoDB operations, AI integrations
- `src/constants/` — PK constants, config values
- `src/middleware/` — Middy middleware (auth, RBAC, error handling)
- `src/types/` — DynamoDB item types extending core schemas with PK/SK

DynamoDB uses single-table design. All operations go through `src/helpers/db.ts` (`createItem`, `getItem`, `queryBySkPrefix`, etc.). PK constants are in `src/constants/`. SK strings are built via helper functions — never manually.

### Frontend (apps/web)

Next.js App Router with Feature-Sliced Design:
- `app/` — Pages and layouts (route groups: `(auth)`, `(dashboard)`)
- `features/` — Domain modules with `components/`, `hooks/`, `lib/`, `index.ts` barrel exports
- `components/ui/` — Shadcn UI primitives
- `lib/hooks/` — Shared SWR data-fetching hooks
- `context/` — Auth, organization providers

State: SWR for server state, AWS Amplify for auth, `nuqs` for URL state.

### Infrastructure (packages/infra)

CDK stacks in `lib/`. API routes defined in `api/routes/<domain>.routes.ts` and registered in `api/api-orchestrator-stack.ts`.

### Shared Types (packages/core)

All domain types are Zod schemas in `src/schemas/`. Types are always inferred via `z.infer<>` — never defined manually. Built with tsup to ESM + CJS.

## Git Workflow

- **develop** — Main development branch. PRs target here. Deploys to dev.
- **main** — Test environment. Promoted from `develop`.
- **production** — Customer-facing. Updated only via Release workflow.
- Create feature branches from `develop`, open PRs to `develop`.

## Key Conventions

Detailed rules are in `.claude/rules/`. The most critical ones:

- **No `any` type.** Use `unknown` with type guards, or specific type assertions.
- **All types from Zod.** `type Foo = z.infer<typeof FooSchema>` — never manual interfaces for domain types.
- **`const` arrow functions** for all function definitions (except Next.js page/layout defaults).
- **Destructure `safeParse`** immediately: `const { success, data, error } = Schema.safeParse(raw)`.
- **`orgId` from request body/query/path** — never from JWT token or `event.auth`.
- **Use `apiResponse()`** from `@/helpers/api` for all REST responses.
- **No raw DynamoDB SDK in handlers** — use helpers from `@/helpers/db` or domain helpers.
- **Skeleton loading states** — never spinners or "Loading..." text.
- **Shadcn UI components** — never raw HTML elements for buttons, inputs, etc.
- **Tests are co-located** with source files (e.g., `create-foo.ts` → `create-foo.test.ts`).
- **Test the exported business function directly**, not the middy-wrapped handler.
- **Mock middy and AWS SDK before imports** in test files.

## Next.js 15 Specifics

- Always use async versions of runtime APIs: `await cookies()`, `await headers()`, `await draftMode()`.
- Handle async params in layouts/pages: `const params = await props.params`.
- Use `useActionState` instead of deprecated `useFormState`.
- URL state management via `nuqs`.

## Lessons Learned

- When modifying handler parameters, update ALL corresponding test files.
- All React hooks must be called before any conditional returns.
- Mock function names must exactly match the imported function names.
- After changing core schemas, rebuild `packages/core` before running dependent tests.