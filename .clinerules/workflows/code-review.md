# Code Review Workflow — AI-Powered Code Audit

> This workflow describes the process for performing a comprehensive code review of a feature, file, or directory.
> It produces a structured review report in `docs/reviews/` with categorized findings, severity levels, and actionable fixes.
>
> **Trigger**: Ask Cline/Claude to "review [feature/file/directory]" — e.g. "review the answer feature", "review apps/functions/src/handlers/clustering/", "review apps/web/components/brief/".

---

## 🎯 Goal

Produce a `docs/reviews/<TARGET>-review-YYYY-MM-DD.md` report that identifies problems, bad practices, weaknesses, and convention violations — with specific file:line references, severity ratings, and suggested fixes.

---

## 📋 Step-by-Step Process

### Step 1 — Identify the Review Scope

Determine what is being reviewed based on the user's input:

| Input Type | Example | Scope |
|---|---|---|
| Feature name | "review the answer feature" | All files in `apps/functions/src/handlers/answer/`, related helpers, constants, schemas, frontend components, and tests |
| Directory path | "review apps/functions/src/handlers/clustering/" | All files in that directory + related test files |
| File path | "review apps/web/components/brief/helpers.ts" | That specific file + its test file (if exists) |
| Schema name | "review the project schema" | `packages/core/src/schemas/project.ts` + all consumers |

**For feature-level reviews**, gather ALL related files:

```
1. Schema:       packages/core/src/schemas/<feature>.ts
2. Constants:    apps/functions/src/constants/<feature>.ts
3. Helpers:      apps/functions/src/helpers/<feature>.ts
4. Handlers:     apps/functions/src/handlers/<feature>/*.ts
5. Tests:        apps/functions/src/handlers/<feature>/*.test.ts
6. CDK routes:   packages/infra/api/routes/<feature>.routes.ts
7. Frontend:     apps/web/components/<feature>/ OR apps/web/features/<feature>/
8. Pages:        apps/web/app/**/<feature>/ (search for related pages)
9. Types:        apps/functions/src/types/<feature>.ts
```

---

### Step 2 — Read All Project Rules

Before reviewing, refresh context on ALL project conventions by reading:

| File | Key Rules |
|---|---|
| `.clinerules/02-typescript-best-practices.md` | No `any`, Zod-inferred types, const arrow functions |
| `.clinerules/03-entity-definitions.md` | Schema patterns, DynamoDB item types |
| `.clinerules/04-backend-architecture.md` | Thin Lambda, safeParse destructuring, orgId sourcing, apiResponse |
| `.clinerules/05-dynamodb-design.md` | Single-table design, PK constants, SK builders |
| `.clinerules/06-frontend-architecture.md` | Feature-Sliced Design, SWR, Skeleton loading, Shadcn UI |
| `.clinerules/09-testing.md` | Test patterns, mock patterns, coverage requirements |
| `.clinerules/10-audit-trail.md` | Audit log requirements for every handler |
| `.clinerules/cost-optimization.md` | AWS cost optimization rules |

---

### Step 3 — Perform the Review

Read every file in scope and evaluate against the checklist categories below. For each finding, record:

- **Category** (from the list below)
- **Severity** (🔴 CRITICAL / 🟠 HIGH / 🟡 MEDIUM / 🔵 LOW)
- **File path + line number** (or line range)
- **Description** of the problem
- **Suggested fix** with a code example (before → after)

---

## 🔍 Review Categories & Checklists

### Category 1: Type Safety

| Check | Severity | What to look for |
|---|---|---|
| No `any` type usage | 🟠 HIGH | Search for `: any`, `as any`, `<any>`, implicit `any` in callbacks |
| Types inferred from Zod | 🟠 HIGH | Manual `interface` or `type` definitions that should be `z.infer<>` |
| No `as Record<string, unknown>` | 🟡 MEDIUM | Loose type assertions instead of proper types |
| No `as unknown as X` chains | 🟡 MEDIUM | Double-cast patterns hiding type errors |
| Proper type guards | 🟡 MEDIUM | Runtime type checking instead of blind assertions |
| Generic function types | 🔵 LOW | Functions missing return types or parameter types |
| Callback parameter types | 🔵 LOW | `.map((item) => ...)` without explicit type on `item` |

### Category 2: Architecture Compliance (Backend)

| Check | Severity | What to look for |
|---|---|---|
| Thin Lambda handlers | 🟠 HIGH | Business logic inside handler instead of helpers |
| `safeParse` destructured | 🟠 HIGH | `const parsed = Schema.safeParse(...)` instead of `const { success, data, error } = ...` |
| `orgId` from request, not token | 🔴 CRITICAL | `event.auth?.orgId`, `event.auth?.claims?.['custom:orgId']` |
| `apiResponse` for REST | 🟠 HIGH | Inline `{ statusCode, headers, body }` instead of `apiResponse()` |
| No raw DynamoDB SDK in handlers | 🟠 HIGH | Direct `DynamoDBClient`, `PutCommand`, `QueryCommand` imports in handlers |
| Middy middleware stack | 🟡 MEDIUM | Missing or incorrect middleware order |
| Sentry wrapper | 🟡 MEDIUM | Missing `withSentryLambda` on exported handler |
| Const arrow functions | 🟡 MEDIUM | `function` keyword instead of `const fn = () => {}` |

### Category 3: DynamoDB Patterns

| Check | Severity | What to look for |
|---|---|---|
| PK constants used | 🟠 HIGH | Magic strings like `'USER'` instead of `PK.USER` |
| SK built via helpers | 🟠 HIGH | Manual string concatenation for sort keys |
| No raw SDK in helpers | 🟡 MEDIUM | Direct SDK usage instead of `@/helpers/db` wrappers |
| Proper query patterns | 🟡 MEDIUM | Full table scans, missing `skPrefix` for queries |
| TTL strategy | 🔵 LOW | Missing TTL for ephemeral data (sessions, tokens, etc.) |

### Category 4: Security

| Check | Severity | What to look for |
|---|---|---|
| No secrets in code | 🔴 CRITICAL | Hardcoded API keys, passwords, tokens |
| No PII in logs | 🔴 CRITICAL | `console.log` with user emails, passwords, tokens |
| Input validation | 🔴 CRITICAL | Missing Zod validation on user input |
| Permission checks | 🟠 HIGH | Missing `requirePermission` middleware on protected routes |
| SQL/NoSQL injection | 🔴 CRITICAL | Unsanitized user input in DynamoDB expressions |
| CORS configuration | 🟡 MEDIUM | Overly permissive CORS settings |
| Error message leakage | 🟡 MEDIUM | Internal error details exposed to clients |

### Category 5: Error Handling

| Check | Severity | What to look for |
|---|---|---|
| Missing error cases | 🟠 HIGH | No handling for `!success` from safeParse |
| Swallowed errors | 🟠 HIGH | Empty `catch` blocks or `catch (e) {}` |
| Generic catch-all | 🟡 MEDIUM | `catch (error: any)` without proper error typing |
| Missing 404 handling | 🟡 MEDIUM | No check for `undefined` result from `getItem` |
| Unhandled promise rejections | 🟠 HIGH | Missing `await` or `.catch()` on promises |
| Error response format | 🟡 MEDIUM | Inconsistent error response shapes |

### Category 6: Performance

| Check | Severity | What to look for |
|---|---|---|
| N+1 query patterns | 🟠 HIGH | Querying DynamoDB in a loop instead of batch operations |
| Missing pagination | 🟡 MEDIUM | Returning all items without limit/pagination |
| Large payload responses | 🟡 MEDIUM | Returning entire entities when only a few fields are needed |
| Unnecessary re-renders | 🟡 MEDIUM | (Frontend) Missing `useMemo`, `useCallback` for expensive operations |
| Bundle size | 🔵 LOW | Importing entire libraries when only specific functions are needed |
| Lambda cold start | 🔵 LOW | Heavy imports at module level that could be lazy-loaded |

### Category 7: Testing

| Check | Severity | What to look for |
|---|---|---|
| Missing test file | 🟠 HIGH | Handler/helper/component without a corresponding `.test.ts` file |
| Happy path only | 🟡 MEDIUM | Tests only cover success cases, no error/edge cases |
| Missing mock resets | 🟡 MEDIUM | No `jest.clearAllMocks()` in `beforeEach` |
| Testing middy wrapper | 🟡 MEDIUM | Testing `handler` instead of the exported business function |
| Hardcoded dates | 🔵 LOW | Exact date assertions instead of `expect.any(String)` |
| Missing validation tests | 🟡 MEDIUM | No tests for invalid input / Zod validation failures |
| Missing guard clause tests | 🟡 MEDIUM | No tests for business rule enforcement |

### Category 8: Audit Trail

| Check | Severity | What to look for |
|---|---|---|
| Missing audit log for CRUD | 🟠 HIGH | Create/Update/Delete handler without `writeAuditLog` |
| Missing audit log for AI ops | 🟠 HIGH | AI generation/tool call without audit logging |
| Blocking audit in hot path | 🟡 MEDIUM | `await writeAuditLog(...)` in high-frequency operations |
| Missing failure audit | 🟡 MEDIUM | Only logging success, not `*_FAILED` actions |
| PII in audit changes | 🔴 CRITICAL | Passwords, tokens, or large text in `changes` field |
| Missing audit action in schema | 🟡 MEDIUM | Using action not defined in `AuditActionSchema` |

### Category 9: Frontend Patterns

| Check | Severity | What to look for |
|---|---|---|
| Spinner/Loading text | 🟠 HIGH | "Loading..." text or spinner components instead of `<Skeleton>` |
| Raw HTML elements | 🟡 MEDIUM | `<button>`, `<input>`, `<select>` instead of Shadcn UI components |
| Business logic in components | 🟠 HIGH | API calls, routing, or complex logic inside components |
| Missing `'use client'` | 🟠 HIGH | Interactive components without the directive |
| Inline type definitions | 🟡 MEDIUM | `interface Props { ... }` that should come from `@auto-rfp/core` |
| Missing barrel exports | 🟡 MEDIUM | Direct imports from internal feature paths |
| Form without react-hook-form | 🟡 MEDIUM | Manual `useState` for form fields |
| Missing loading states | 🟠 HIGH | SWR hooks without handling `isLoading` |
| Missing error states | 🟡 MEDIUM | SWR hooks without handling `error` |

### Category 10: Code Quality

| Check | Severity | What to look for |
|---|---|---|
| Dead code | 🟡 MEDIUM | Commented-out code, unused functions, unreachable branches |
| Unused imports | 🔵 LOW | Imported symbols not used in the file |
| Magic numbers/strings | 🟡 MEDIUM | Hardcoded values that should be constants |
| Code duplication | 🟡 MEDIUM | Similar logic repeated across files |
| Naming conventions | 🔵 LOW | Inconsistent naming (camelCase vs snake_case, etc.) |
| File length | 🔵 LOW | Files exceeding 300 lines that should be split |
| Console.log in production | 🟡 MEDIUM | Debug `console.log` statements left in code |
| TODO/FIXME/HACK comments | 🔵 LOW | Unresolved technical debt markers |
| `var` usage | 🟡 MEDIUM | `var` instead of `const`/`let` |
| `.js` in import paths | 🟡 MEDIUM | Import paths with `.js` extension |

### Category 11: End-to-End Wiring

Validates that the full stack is properly connected — from CDK route definitions through Lambda handlers to frontend hooks and UI components.

| Check | Severity | What to look for |
|---|---|---|
| Lambda handler exists for each CDK route | 🔴 CRITICAL | CDK route `entry` points to a handler file that doesn't exist or doesn't export `handler` |
| CDK route method matches handler logic | 🟠 HIGH | Route defines `GET` but handler reads `event.body` (expects POST), or route defines `POST` but handler reads `pathParameters` only |
| CDK route path params match handler extraction | 🟠 HIGH | Route defines `{projectId}/{questionId}` but handler only extracts `projectId` from `event.pathParameters` |
| Every handler has a corresponding CDK route | 🟠 HIGH | Handler file exists in `apps/functions/src/handlers/<domain>/` but no route in `packages/infra/api/routes/<domain>.routes.ts` points to it |
| Frontend hook exists for each API endpoint | 🟠 HIGH | CDK route exists but no corresponding SWR hook or fetcher in `apps/web/lib/hooks/` calls that endpoint |
| Hook API path matches CDK route path | 🔴 CRITICAL | Hook calls `/clustering/clusters/{projectId}` but CDK route defines `/clustering/cluster/{projectId}` (singular vs plural mismatch) |
| Hook HTTP method matches CDK route method | 🟠 HIGH | Hook uses `GET` but CDK route defines `POST`, or hook sends body on a `GET` endpoint |
| Hook query params match handler extraction | 🟡 MEDIUM | Hook sends `?orgId=...&threshold=...` but handler only reads `orgId` from query params (ignores `threshold`) |
| Hook is actually called from a UI component | 🟠 HIGH | Hook is defined in `use-clustering.ts` but never imported/called from any component or page |
| UI component passes correct props to hook | 🟡 MEDIUM | Component calls `useSimilarQuestions(projectId, questionId)` but hook signature expects `(projectId, questionId, options)` with required `options.orgId` |
| Mutation hook result is used correctly | 🟡 MEDIUM | `useApplyClusterAnswer()` returns `{ trigger, isMutating }` but component only destructures `{ trigger }` and doesn't show loading state |
| Response type matches between API and UI | 🟡 MEDIUM | Handler returns `{ clusters, totalClusters }` but hook/component expects `{ clusters, total }` (field name mismatch) |
| CDK domain is registered in orchestrator | 🔴 CRITICAL | Domain routes file exists but is not imported/called in `api-orchestrator-stack.ts` |
| Request body fields match between FE and BE | 🟠 HIGH | Frontend sends `{ sourceQuestionId, targetIds }` but handler schema expects `{ sourceQuestionId, targetQuestionIds }` (field name mismatch) |
| Request body uses shared Zod schema | 🟠 HIGH | Frontend constructs request body ad-hoc instead of using the shared `XxxRequestSchema` type from `@auto-rfp/core` |
| Response fields consumed by FE exist in BE response | 🟠 HIGH | Component reads `data.totalClusters` but handler returns `data.total` — causes `undefined` at runtime |
| Response type uses shared Zod schema | 🟡 MEDIUM | Hook types response as `any` or inline interface instead of using `XxxResponse` from `@auto-rfp/core` |
| Path params sent by FE match BE extraction | 🟠 HIGH | Hook calls `/similar/${projectId}/${questionId}` but handler extracts `{ projectId, id }` from `event.pathParameters` (param name mismatch) |
| Query params sent by FE match BE extraction | 🟡 MEDIUM | Hook sends `?fileId=...` but handler reads `event.queryStringParameters?.questionFileId` (different param name) |
| Optional vs required params aligned | 🟡 MEDIUM | Handler requires `opportunityId` in body (Zod `.min(1)`) but frontend sends it as optional/empty string |
| Error response shape handled by FE | 🟡 MEDIUM | Handler returns `{ message, issues }` on 400 but frontend only reads `err.message` and ignores validation `issues` |

**How to verify wiring:**

```
1. CDK Route File:     packages/infra/api/routes/<feature>.routes.ts
   → Lists all routes with method, path, and handler entry point

2. Handler Files:      apps/functions/src/handlers/<feature>/*.ts
   → Each must export `handler` (middy-wrapped) and `baseHandler`

3. Frontend Hooks:     apps/web/lib/hooks/use-<feature>.ts
   → Each API endpoint should have a corresponding hook or fetcher
   → API paths in hooks must match CDK route paths exactly

4. UI Components:      apps/web/app/**/<feature>/ or apps/web/components/<feature>/
   → Must import and call the hooks
   → Must handle loading, error, and empty states from hooks

5. Orchestrator:       packages/infra/api/api-orchestrator-stack.ts
   → Must import and register the domain routes
```

**Automated checks for wiring:**

```bash
# Verify all CDK route handler files exist
grep -oP "entry: lambdaEntry\('([^']+)'\)" packages/infra/api/routes/<feature>.routes.ts | \
  sed "s/.*'\(.*\)'.*/apps\/functions\/src\/handlers\/\1/" | \
  while read f; do test -f "$f" || echo "MISSING HANDLER: $f"; done

# Verify all handlers export 'handler'
grep -rL 'export const handler' apps/functions/src/handlers/<feature>/*.ts | grep -v '.test.'

# Verify hook API paths match CDK routes
grep -oP "basePath: '([^']+)'" packages/infra/api/routes/<feature>.routes.ts
grep -oP "path: '([^']+)'" packages/infra/api/routes/<feature>.routes.ts
# Compare with:
grep -oP '\$\{env\.BASE_API_URL\}/[^`"'"'"']+' apps/web/lib/hooks/use-<feature>.ts

# Verify hooks are imported in UI components
grep -rn 'use-<feature>\|use<Feature>' apps/web/app/ apps/web/components/ --include='*.tsx'

# Verify domain is registered in orchestrator
grep '<feature>Domain' packages/infra/api/api-orchestrator-stack.ts
```

### Category 12: Documentation & Readability

| Check | Severity | What to look for |
|---|---|---|
| Complex functions without comments | 🔵 LOW | Functions > 20 lines with no explanation |
| Unclear function names | 🔵 LOW | Names that don't describe what the function does |
| Missing JSDoc for public APIs | 🔵 LOW | Exported functions without parameter/return documentation |
| Outdated comments | 🟡 MEDIUM | Comments that don't match the current code behavior |

---

## 📊 Severity Definitions

| Level | Icon | Meaning | Action Required |
|---|---|---|---|
| CRITICAL | 🔴 | Security vulnerabilities, data loss risks, crashes, compliance violations | Must fix before merge/deploy |
| HIGH | 🟠 | Convention violations, missing tests, missing audit logs, architectural issues | Should fix in current sprint |
| MEDIUM | 🟡 | Code quality issues, performance concerns, minor pattern violations | Fix when touching the file |
| LOW | 🔵 | Style issues, minor improvements, suggestions, nice-to-haves | Optional / backlog |

---

### Step 4 — Generate the Review Report

Create the report file at `docs/reviews/<TARGET>-review-YYYY-MM-DD.md` with this structure:

```markdown
# Code Review: <Target Name>

**Date**: YYYY-MM-DD
**Reviewer**: Cline/Claude AI
**Scope**: <description of what was reviewed>
**Files Reviewed**: <count>

---

## 📊 Summary

| Severity | Count |
|---|---|
| 🔴 CRITICAL | X |
| 🟠 HIGH | X |
| 🟡 MEDIUM | X |
| 🔵 LOW | X |
| **Total** | **X** |

### Overall Assessment

<1-2 paragraph summary of the overall code quality, main strengths, and key areas for improvement>

### Top 3 Priority Items

1. <Most important finding>
2. <Second most important>
3. <Third most important>

---

## 🔴 Critical Findings

### CR-1: <Title>
- **Category**: <Category Name>
- **File**: `<file-path>` (line X-Y)
- **Description**: <What's wrong and why it matters>
- **Impact**: <What could go wrong>

**Current code:**
```typescript
// problematic code
```

**Suggested fix:**
```typescript
// fixed code
```

---

## 🟠 High Findings

### HI-1: <Title>
...

---

## 🟡 Medium Findings

### ME-1: <Title>
...

---

## 🔵 Low Findings

### LO-1: <Title>
...

---

## ✅ What's Done Well

<List 3-5 things the code does correctly — positive reinforcement>

1. <Good practice observed>
2. <Good practice observed>
3. <Good practice observed>

---

## 📋 Action Items Checklist

- [ ] CR-1: <brief description>
- [ ] HI-1: <brief description>
- [ ] ME-1: <brief description>
- [ ] LO-1: <brief description>

---

## 📁 Files Reviewed

| File | Lines | Findings |
|---|---|---|
| `<file-path>` | X | CR:0 HI:1 ME:2 LO:0 |
| `<file-path>` | X | CR:0 HI:0 ME:1 LO:1 |
| ... | ... | ... |
```

---

### Step 5 — Cross-Reference with Related Files

After the initial review, check for **cross-cutting concerns**:

1. **Schema consumers**: If reviewing a schema, check all files that import it for breaking changes
2. **Handler ↔ Test alignment**: Verify test files match the current handler signatures
3. **Route ↔ Handler alignment**: Verify CDK route definitions match handler exports
4. **Frontend ↔ API alignment**: Verify frontend hooks call the correct API paths with correct params
5. **Audit action coverage**: Verify all CRUD operations have corresponding audit actions in the schema

---

### Step 6 — Run Automated Checks (if applicable)

When possible, run these commands to supplement the manual review:

```bash
# TypeScript compilation check
cd <package-dir> && pnpm tsc --noEmit 2>&1

# Search for `any` usage in reviewed files
grep -rn ': any\|as any\|<any>' <file-or-dir>

# Search for console.log in production code
grep -rn 'console\.log' <file-or-dir> --include='*.ts' --include='*.tsx' | grep -v '.test.' | grep -v 'node_modules'

# Search for TODO/FIXME/HACK
grep -rn 'TODO\|FIXME\|HACK\|XXX' <file-or-dir> --include='*.ts' --include='*.tsx'

# Check for missing test files
find <handler-dir> -name '*.ts' ! -name '*.test.ts' ! -name '*.d.ts' -exec sh -c 'test -f "${1%.ts}.test.ts" || echo "MISSING TEST: $1"' _ {} \;

# Search for raw DynamoDB SDK usage in handlers
grep -rn 'DynamoDBClient\|PutCommand\|GetCommand\|QueryCommand\|DeleteCommand\|UpdateCommand' <handler-dir> --include='*.ts' | grep -v '.test.' | grep -v 'node_modules' | grep -v 'helpers/'

# Search for orgId from auth/token
grep -rn 'event\.auth\.\(orgId\|claims\)' <handler-dir> --include='*.ts' | grep -v '.test.'

# Search for inline response objects
grep -rn 'statusCode:.*headers:.*body:' <handler-dir> --include='*.ts' | grep -v '.test.' | grep -v 'node_modules'
```

---

### Step 7 — Present Findings & Recommendations

After generating the report:

1. **Summarize** the key findings to the user
2. **Highlight** the most critical items that need immediate attention
3. **Offer** to fix specific issues if the user wants
4. **Suggest** whether a follow-up review is needed after fixes

---

## 🔄 Review Variants

### Quick Review (Single File)
- Skip Steps 2 and 5
- Focus on Categories 1-5 and 10
- Shorter report format

### Feature Review (Full Feature)
- All steps
- All categories
- Full report format

### Security Review (Security Focus)
- Steps 1-4 only
- Focus on Categories 4, 1, and 5
- Include dependency vulnerability check: `pnpm audit`

### Pre-Deploy Review (Release Readiness)
- All steps
- Extra focus on Categories 4, 5, 7, and 8
- Include compilation check and test run
- Verify all tests pass: `pnpm test`

---

## 🚨 Common Anti-Patterns to Flag

These are the most frequently occurring issues in this codebase. Always check for them:

| Anti-Pattern | Where to Look | Fix |
|---|---|---|
| `const parsed = Schema.safeParse(...)` then `parsed.success` | Lambda handlers | Destructure: `const { success, data, error } = ...` |
| `event.auth?.orgId` or `event.auth?.claims?.['custom:orgId']` | Lambda handlers | Read from body/query/path params |
| `return { statusCode: 200, headers: {...}, body: JSON.stringify(...) }` | Lambda handlers | Use `apiResponse(200, data)` |
| `function myFunction()` | Everywhere | Use `const myFunction = () => {}` |
| `type Foo = { ... }` without Zod | Schema files | Define Zod schema, infer type |
| `as any` or `: any` | Everywhere | Use proper types or `unknown` with guards |
| `console.log(...)` | Production code | Remove or use structured logging |
| Missing `writeAuditLog` | CRUD handlers | Add audit logging per `.clinerules/10-audit-trail.md` |
| `<div>Loading...</div>` or `<Spinner />` | React components | Use `<Skeleton>` from Shadcn UI |
| `import { X } from './components/X'` | Feature pages | Use barrel: `import { X } from '@/features/feature'` |
| No `.test.ts` file for handler | Handler directories | Create test file per `.clinerules/09-testing.md` |
| `await writeAuditLog(...)` in hot path | High-frequency handlers | Use non-blocking `.catch()` pattern |
| CDK route exists but no frontend hook calls it | CDK routes ↔ hooks | Create hook in `apps/web/lib/hooks/use-<feature>.ts` |
| Hook defined but never imported in UI | Hooks ↔ components | Import and call hook from the relevant page/component |
| Hook API path doesn't match CDK route path | Hooks ↔ CDK routes | Align URL paths exactly (check singular/plural, param names) |
| Handler exists but no CDK route points to it | Handlers ↔ CDK routes | Add route in `packages/infra/api/routes/<feature>.routes.ts` |
| CDK domain not registered in orchestrator | CDK routes ↔ orchestrator | Import and call `<feature>Domain()` in `api-orchestrator-stack.ts` |
| FE request body field names don't match BE schema | Hooks ↔ Handlers | Use shared `XxxRequest` type from `@auto-rfp/core` for both FE and BE |
| FE reads response field that doesn't exist in BE | Hooks/Components ↔ Handlers | Use shared `XxxResponse` type from `@auto-rfp/core`; verify field names match |
| FE query param name differs from BE extraction | Hooks ↔ Handlers | Align param names: if FE sends `?fileId=`, BE must read `queryStringParameters?.fileId` |
| FE sends optional value but BE requires it | Hooks ↔ Zod schemas | Check Zod schema `.min(1)` / `.optional()` matches what FE actually sends |

---

## 📝 Example Usage

### Example 1: Review a feature
```
User: "Review the answer feature"
→ Scope: schemas/answer.ts, handlers/answer/*.ts, helpers/answer.ts, constants/answer.ts, 
         web components/answer/, tests, CDK routes
→ Output: docs/reviews/answer-feature-review-2026-03-05.md
```

### Example 2: Review a specific file
```
User: "Review apps/functions/src/handlers/clustering/apply-cluster-answer.ts"
→ Scope: That file + its test file
→ Output: docs/reviews/apply-cluster-answer-review-2026-03-05.md
```

### Example 3: Review a directory
```
User: "Review the brief components"
→ Scope: apps/web/components/brief/**
→ Output: docs/reviews/brief-components-review-2026-03-05.md
```

### Example 4: Security review
```
User: "Security review the auth handlers"
→ Scope: All auth-related handlers, middleware, Cognito integration
→ Output: docs/reviews/auth-security-review-2026-03-05.md
```

---

## 🔗 Related Files

- `.clinerules/02-typescript-best-practices.md` — Type safety rules
- `.clinerules/04-backend-architecture.md` — Lambda handler conventions
- `.clinerules/06-frontend-architecture.md` — Frontend component patterns
- `.clinerules/09-testing.md` — Testing requirements
- `.clinerules/10-audit-trail.md` — Audit logging requirements
- `.clinerules/workflows/architecture.md` — Architecture workflow (for new features)
- `.clinerules/workflows/implementation.md` — Implementation workflow (for building features)
