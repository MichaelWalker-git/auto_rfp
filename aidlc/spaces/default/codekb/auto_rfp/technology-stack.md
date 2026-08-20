# Technology Stack — AutoRFP

## Languages & Runtimes

| Item | Version | Where |
|---|---|---|
| TypeScript (strict, ESM) | per-package tsconfigs | all packages |
| Node.js | >= 20 | Lambda runtime and tooling floor |
| pnpm | 10.10.0 | workspace package manager |

## Frontend (`apps/web`)

| Library | Version | Purpose |
|---|---|---|
| Next.js | 16.0.10 (package.json pin; CLAUDE.md says "15+") | App Router frontend |
| React / React DOM | ^18.3.1 | UI |
| Tailwind CSS | ^4 | styling; Shadcn UI primitives in `components/ui/` |
| SWR | ^2.3.3 | client data fetching (`authenticatedFetcher`) |
| aws-amplify | ^6.15.8 | Cognito auth |
| nuqs | ^2.8.8 | URL query state |
| react-hook-form | ^7.56.1 | forms |
| @hookform/resolvers | ^5.0.1 | Zod form validation |
| TipTap | ^3.20.0 | rich-text editing (solution plan + documents) |
| @sentry/nextjs | ^10.43.0 | error tracking |

## Backend (`apps/functions`)

| Library | Version | Purpose |
|---|---|---|
| @middy/core | ^7.0.2 | Lambda middleware stack |
| @aws-sdk v3 | ^3.982.0 | AWS clients (DynamoDB, S3, SQS, Cognito, …) |
| Zod | ^3.24/^3.25 | validation; all domain types via `z.infer` |
| @pinecone-database/pinecone | ^6.1.4 | vector search (org-namespaced, metadata-filtered) |
| @sentry/serverless | ^7.120.4 | error tracking (`withSentryLambda`) |
| Bedrock | via HTTPS client only (`bedrock-http-client.ts`, SSM API key) | AI model invocation — SDK import forbidden |

## Shared & Infrastructure

| Item | Version | Purpose |
|---|---|---|
| tsup | ^8 | `packages/core` build (ESM + CJS) |
| aws-cdk-lib | ^2.230–2.237 | infrastructure as code |
| DynamoDB | single table, `partition_key`/`sort_key` | primary datastore |
| API Gateway HTTP API | v2 | REST surface |
| Step Functions, SQS, S3, Cognito, Amplify Hosting | — | pipelines, queues, storage, auth, web hosting |

## Testing & Quality Tooling

| Tool | Version | Scope |
|---|---|---|
| Jest | ^29/^30 | functions, web, infra unit tests |
| Vitest | ^2 (core) / ^4 (web dep) | core schema tests |
| Playwright | ^1.48 | web e2e |
| Cypress | workflow present | e2e (CI workflow exists) |
| ESLint (flat config) | `apps/web/eslint.config.mjs` | **web only** — no eslint config in `apps/functions` |
