# Technology Stack — AutoRFP

> Versions as observed in the focused scan (intent `260821-solution-plan-versioning`, 2026-08-27). Package manifests outside the scanned packages were not audited.

## Languages & Runtimes

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode), ESM everywhere (`"type": "module"`) |
| Backend runtime | Node.js 20 (Lambda) |
| Frontend runtime | Next.js App Router / React |
| Package manager | pnpm workspaces |

## Frameworks & Libraries

| Library | Version | Where / Purpose |
|---|---|---|
| zod | ^3.24 / 3.25 | packages/core — all domain schemas; types via `z.infer<>` |
| Next.js | 16.0.10 | apps/web — App Router frontend |
| React | ^18.3 | apps/web |
| SWR | ^2.3.3 | apps/web — server state (`authenticatedFetcher`; plan status polled at 3s) |
| Tailwind CSS | 4 | apps/web styling |
| Shadcn UI | — | apps/web component primitives |
| TipTap | — | Solution-plan HTML editor (`SolutionPlanEditorPage.tsx`) |
| @middy/core | ^7 | apps/functions — middleware stack `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware` (+ `auditMiddleware` on init) |
| Sentry (Lambda) | — | `withSentryLambda` wraps every REST handler |
| aws-cdk-lib | ^2.230–2.237 | packages/infra — stacks, `NodejsFunction` bundling via `lambdaEntry()` |
| ulid | — | run ids (`runId`) |
| uuid | — | entity ids |
| tsup | — | packages/core build (ESM + CJS) |

## AI Integration

- **Amazon Bedrock — HTTP only**: all model invocations go through `apps/functions/src/helpers/bedrock-http-client.ts` (SSM-cached API key). The AWS SDK Bedrock client is never imported. `invokeClaudeJson` (in `executive-opportunity-brief.ts`) is the JSON-invocation utility observed.
- Grilling/synthesis (SQS worker) and team-regenerate matching are the Bedrock call sites in the scanned area.

## Testing & Quality Tooling

| Tool | Version | Scope |
|---|---|---|
| Jest | 30 | apps/functions unit tests (co-located `*.test.ts`) |
| Jest + React Testing Library | 29 | apps/web unit/component tests (`__tests__/`) |
| Vitest | — | packages/core schema tests |
| Playwright | — | apps/web e2e (`e2e-tests.yml`) |
| Cypress | — | e2e (`cypress.yml`) |
| ESLint | flat config | apps/web (no root `.prettierrc` observed) |
| Lighthouse CI | — | `lighthouse.yml` |

## AWS Services (scanned area)

DynamoDB (single table, PAY_PER_REQUEST convention), S3 (versioned plan-HTML keys, retained), SQS (`auto-rfp-solution-plan-{stage}` + DLQ), API Gateway + Lambda, Cognito (auth via Amplify on the web side), SSM (Bedrock API key cache), CloudWatch Logs. Step Functions exist elsewhere in the repo (answer/document/question pipelines) but the solution-plan flow is a plain SQS worker.
