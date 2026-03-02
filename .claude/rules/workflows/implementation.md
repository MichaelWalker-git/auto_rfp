# Developer Workflow — Implementing a Feature from a Doc

> This workflow guides the AI through implementing a feature that already has an architecture document in `docs/`.
> Follow these steps in order. Do not skip steps or implement multiple steps at once.

---

## 🎯 Goal

Take a `docs/<FEATURE>-IMPLEMENTATION.md` file and produce all the code changes needed to implement the feature — correctly, completely, and consistently with the project conventions.

---

## 📋 Pre-flight Checklist

Before starting, confirm:
- [ ] The implementation doc exists and has been reviewed
- [ ] You have read the relevant `.clinerules/` files for the domains being touched
- [ ] You understand which packages are affected (`packages/core`, `apps/functions`, `packages/infra`, `apps/web`)

---

## 📦 Implementation Order

Always implement in this order. Each step depends on the previous one.

```
1. Core schemas  →  2. Constants & helpers  →  3. Lambda handlers
       ↓
4. CDK routes  →  5. CDK infrastructure  →  6. Frontend hooks  →  7. Frontend components
```

---

## Step 1 — Core Schemas (`packages/core`)

**What to do:**
1. Read the "Data Models & Zod Schemas" section of the implementation doc
2. Create `packages/core/src/schemas/<feature>.ts` with all schemas exactly as documented
3. Add `export * from './<feature>';` to `packages/core/src/schemas/index.ts`

**Rules:**
- All types MUST be inferred from Zod: `export type Foo = z.infer<typeof FooSchema>`
- Never define types manually
- Use `z.enum([...])` for status/type fields — never TypeScript enums
- Export every schema and type (both the schema and the inferred type)

**Verify:**
```bash
cd packages/core && pnpm tsc --noEmit
```

---

## Step 2 — Constants & Helpers (`apps/functions`)

**What to do:**
1. Read the "DynamoDB Design" section of the implementation doc
2. Create `apps/functions/src/constants/<feature>.ts` with PK constants and TTL values
3. Create `apps/functions/src/helpers/<feature>.ts` with:
   - SK builder functions
   - DynamoDB helper functions (wrapping `@/helpers/db`)

**Rules:**
- SK builders: pure functions, no side effects, no DynamoDB calls
- DynamoDB helpers: wrap `createItem`, `putItem`, `getItem`, `deleteItem`, `queryBySkPrefix` from `@/helpers/db`
- Never use raw `DynamoDBClient`, `PutCommand`, `QueryCommand` etc. in helpers
- Import types from `@auto-rfp/core` — never redefine them

**Verify:**
```bash
cd apps/functions && pnpm tsc --noEmit
```

---

## Step 3 — Lambda Handlers (`apps/functions/src/handlers/<feature>/`)

**What to do:**
1. Read the "Backend — Lambda Handlers" section of the implementation doc
2. Create each handler file exactly as documented
3. For each handler, verify it follows the thin Lambda pattern

**Rules (enforce for every handler):**

| Rule | Check |
|---|---|
| No raw DynamoDB SDK | No `DynamoDBClient`, `PutCommand`, etc. in imports |
| `orgId` from request | From `data.orgId`, `queryStringParameters?.orgId`, or path param — never `event.auth` |
| `safeParse` destructured | `const { success, data, error } = Schema.safeParse(raw)` |
| `apiResponse` for REST | Never `{ statusCode, headers, body }` inline |
| WebSocket returns plain object | `return { statusCode: 200, body: 'OK' }` — no `apiResponse` |
| Middy stack | `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware` |
| Sentry wrapper | `export const handler = withSentryLambda(middy(baseHandler)...)` |

**Verify:**
```bash
cd apps/functions && pnpm tsc --noEmit
```

---

## Step 4 — API Routes (`packages/infra/api/routes/`)

**What to do:**
1. Read the "REST API Routes" section of the implementation doc
2. Create `packages/infra/api/routes/<feature>.routes.ts`
3. Register the domain in `packages/infra/api/api-orchestrator-stack.ts`:
   - Add import
   - Add to `allDomains` array
   - Add to `domainStackNames` array (same index position)

**Rules:**
- Use `lambdaEntry('feature/handler-name.ts')` for all entry paths
- Default auth is `'COGNITO'` — only override if the doc specifies otherwise
- Route paths use `{paramName}` for path parameters

---

## Step 5 — CDK Infrastructure (`packages/infra/`)

**What to do:**
1. Read the "CDK Stack Updates" and "WebSocket Infrastructure" sections of the doc
2. Create any new CDK stack files
3. Wire new stacks into `packages/infra/bin/auto-rfp-infrastructure.ts`
4. Add IAM permissions to the shared Lambda role
5. Enable DynamoDB TTL if the doc specifies it

**Rules:**
- Every Lambda MUST have an explicit `logs.LogGroup` with:
  - `retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS`
  - `removalPolicy: cdk.RemovalPolicy.DESTROY`
- Lambda function names follow: `auto-rfp-<feature>-<action>-${stage}`
- Reuse `sharedInfraStack.commonLambdaRole` — don't create new roles
- SQS queues need a DLQ with `maxReceiveCount: 3`

**Verify:**
```bash
cd packages/infra && pnpm tsc --noEmit
```

---

## Step 6 — Frontend Hooks (`apps/web/features/<feature>/hooks/`)

**What to do:**
1. Read the "Frontend — Hooks & Components" section of the doc
2. Create the `apps/web/features/<feature>/` directory structure
3. Implement all hooks as documented

**Rules:**
- All hooks start with `'use client'`
- Use `useSWR` / `useSWRInfinite` with `authenticatedFetcher` for REST data
- Use `mutate(key)` after mutations to revalidate
- WebSocket hook manages connection lifecycle in `useEffect` with cleanup
- Types imported from `@auto-rfp/core` — never defined inline
- `orgId` passed as a parameter to hooks — never read from a global store

---

## Step 7 — Frontend Components (`apps/web/features/<feature>/components/`)

**What to do:**
1. Implement all components as documented
2. Create the barrel export `apps/web/features/<feature>/index.ts`
3. Add `NEXT_PUBLIC_` env vars to `apps/web/.env.example` if needed

**Rules:**
- All interactive components start with `'use client'`
- Use Shadcn UI components from `@/components/ui/` — never raw HTML `<button>`, `<input>`, etc.
- Loading states use `<Skeleton>` — never spinners or "Loading..."
- Components are pure presentation — no API calls, no routing logic
- All logic lives in hooks, not components
- Barrel export: `export { ComponentName } from './components/ComponentName'`

**Verify:**
```bash
cd apps/web && pnpm tsc --noEmit
```

---

## ✅ Final Verification Checklist

After all steps are complete, verify:

### Code Quality
- [ ] `pnpm tsc --noEmit` passes in all affected packages
- [ ] No `any` types introduced
- [ ] No manually defined types (all inferred from Zod)
- [ ] No raw DynamoDB SDK in any handler
- [ ] No `parsed.success` / `parsed.data` patterns (all destructured)
- [ ] No `event.auth?.orgId` or token-based orgId reads

### Completeness
- [ ] All files listed in the doc's "Summary of New Files" table exist
- [ ] All schemas exported from `packages/core/src/schemas/index.ts`
- [ ] All routes registered in `api-orchestrator-stack.ts`
- [ ] All new permissions added to `packages/core/src/schemas/user.ts`
- [ ] All new env vars added to `apps/web/.env.example`
- [ ] All Lambda functions have a CloudWatch Log Group in CDK

### Conventions
- [ ] Feature-Sliced Design structure followed for frontend
- [ ] Barrel exports in place (`features/<feature>/index.ts`)
- [ ] `withSentryLambda` wrapping all REST Lambda handlers
- [ ] Middy middleware stack on all REST handlers

---

## 🚨 Common Mistakes to Avoid

| Mistake | Correct approach |
|---|---|
| Defining types manually | Infer from Zod: `type Foo = z.infer<typeof FooSchema>` |
| Using raw `DynamoDBClient` in handlers | Call domain helpers from `@/helpers/<feature>` |
| Reading `orgId` from `event.auth` | Read from `data.orgId` or `queryStringParameters?.orgId` |
| Keeping `const parsed = Schema.safeParse(...)` | Destructure: `const { success, data, error } = Schema.safeParse(...)` |
| Returning `{ statusCode, headers, body }` inline | Use `apiResponse(status, body)` |
| Using `apiResponse` in WebSocket handlers | Return `{ statusCode, body }` directly |
| Importing from internal feature paths | Import from barrel: `@/features/<feature>` |
| Using spinners for loading | Use `<Skeleton>` components |
| Putting business logic in Lambda handlers | Move to `@/helpers/<feature>` |
| Creating a new IAM role per Lambda | Reuse `sharedInfraStack.commonLambdaRole` |
| Forgetting CloudWatch Log Group | Add `new logs.LogGroup(...)` for every Lambda |
