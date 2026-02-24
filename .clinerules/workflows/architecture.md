# Architecture Workflow — Feature Documentation

> This workflow describes the process for producing a complete, implementation-ready architecture document for a new feature ticket.
> Follow these steps in order every time a new feature needs to be designed and documented.

---

## 🎯 Goal

Produce a `docs/<FEATURE-NAME>-IMPLEMENTATION.md` file that a developer can follow directly to implement the feature — with no ambiguity about file locations, data models, API contracts, or coding conventions.

---

## 📋 Step-by-Step Process

### Step 1 — Understand the Ticket

- Read the full ticket: business context, features list, acceptance criteria, estimated hours.
- Identify the main domains involved (e.g. presence, comments, assignments, activity).
- Note any referenced sections (e.g. "Section 8 — Multi-tenancy").

---

### Step 2 — Explore the Existing Codebase

Before writing anything, read the relevant existing files to understand patterns:

| What to read | Why |
|---|---|
| `packages/core/src/schemas/*.ts` | Understand existing Zod schema patterns |
| `apps/functions/src/constants/common.ts` | PK_NAME, SK_NAME constants |
| `apps/functions/src/helpers/db.ts` | Available DynamoDB helpers (createItem, putItem, getItem, queryBySkPrefix, etc.) |
| `apps/functions/src/helpers/*.ts` | Domain helper patterns |
| `apps/functions/src/handlers/<domain>/*.ts` | Thin Lambda handler patterns |
| `apps/functions/src/middleware/rbac-middleware.ts` | Auth middleware, AuthedEvent type, orgId sourcing |
| `packages/infra/api/routes/*.ts` | Route definition patterns |
| `packages/infra/api/api-orchestrator-stack.ts` | How routes are registered |
| `packages/infra/database-stack.ts` | DynamoDB table structure, GSIs, streams |
| `docs/IMPLEMENTATION-TICKETS.md` | Reference for ticket format |

---

### Step 3 — Design the Data Model

1. **Define Zod schemas** in `packages/core/src/schemas/<feature>.ts`
   - Every entity schema (item, create DTO, update DTO, response)
   - All types inferred from Zod — never defined manually
   - Export from `packages/core/src/schemas/index.ts`

2. **Design DynamoDB access patterns**
   - Choose PK constants (add to `apps/functions/src/constants/<feature>.ts`)
   - Design SK patterns: `{orgId}#{projectId}#{entityId}` etc.
   - Document in a table: Entity | PK | SK | Notes
   - Define TTL strategy if applicable

3. **Write SK builder functions** in `apps/functions/src/helpers/<feature>.ts`
   - One function per entity type
   - Never construct SK strings manually in handlers

4. **Write DynamoDB helper functions** in the same helpers file
   - Wrap `createItem`, `putItem`, `getItem`, `deleteItem`, `queryBySkPrefix` from `@/helpers/db`
   - One helper per operation (e.g. `createComment`, `listComments`, `upsertAssignment`)
   - Handlers call helpers — never raw SDK commands

---

### Step 4 — Design the API Surface

1. **REST endpoints** — for each operation:
   - Method + path
   - Request shape (query params / body)
   - Response shape
   - Required permission

2. **WebSocket endpoints** (if real-time) — document:
   - Connection URL + query params
   - Inbound message types (client → server)
   - Outbound broadcast message types (server → client)

---

### Step 5 — Write Lambda Handlers

Follow the **thin Lambda** pattern for every handler:

```
parse event → validate with Zod (destructure safeParse) → call helper → return apiResponse
```

Rules to enforce in every handler:
- **No raw DynamoDB SDK** — use helpers from `@/helpers/db` or domain helpers
- **`orgId` from body / query param / path param** — never from `event.auth?.claims` or token
  - POST/PUT/PATCH: `const orgId = data.orgId ?? event.queryStringParameters?.orgId`
  - GET/DELETE: `const { orgId } = event.queryStringParameters ?? {}`
- **`safeParse` always destructured**: `const { success, data, error } = Schema.safeParse(raw)`
- **`apiResponse` for all REST responses** — never inline `{ statusCode, headers, body }`
- **WebSocket handlers** return plain `{ statusCode, body }` — `apiResponse` is REST-only
- **Middy middleware stack**: `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware`

---

### Step 6 — Design Infrastructure (CDK)

- New Lambda functions → add to appropriate CDK stack
- New API routes → create `packages/infra/api/routes/<feature>.routes.ts`
- Register domain in `api-orchestrator-stack.ts` (`allDomains` array + `domainStackNames` array)
- WebSocket API → new `<Feature>WebSocketStack` extending `cdk.Stack`
- Every Lambda → explicit `logs.LogGroup` with retention (2 weeks non-prod, INFINITE prod)
- New IAM permissions → add to shared Lambda role
- DynamoDB TTL → enable on `ttl` attribute if using auto-expiry

---

### Step 7 — Design the Frontend

Follow Feature-Sliced Design under `apps/web/features/<feature>/`:

```
features/<feature>/
├── lib/          # Singletons, clients, pure utilities
├── hooks/        # SWR data hooks + WebSocket hooks
├── components/   # Presentation-only React components
└── index.ts      # Barrel export
```

Rules:
- **SWR** for all REST data fetching (`useSWR`, `useSWRInfinite`)
- **Skeleton components** for loading states — never spinners or "Loading..."
- **`authenticatedFetcher`** for all API calls
- **`'use client'`** on all interactive components and hooks
- **Types from `@auto-rfp/core`** — never define inline interfaces in components
- **Barrel exports** — pages import from `@/features/<feature>`, never from internal paths

---

### Step 8 — Write the Document

Create `docs/<FEATURE-NAME>-IMPLEMENTATION.md` with these sections:

1. **Overview** — feature summary table
2. **Architecture Overview** — ASCII diagram + technology decision table
3. **Data Models & Zod Schemas** — full schema file content
4. **DynamoDB Design** — PK constants, access pattern table, SK builders, DynamoDB helpers
5. **Backend — Lambda Handlers** — file structure tree + full handler code for each
6. **WebSocket Infrastructure (CDK)** — full CDK stack code (if applicable)
7. **REST API Routes** — routes file + registration snippet + endpoint summary table
8. **Frontend — Hooks & Components** — file structure tree + full code for each
9. **Permissions & RBAC** — new permissions + role matrix table
10. **Email Notifications** — async worker pattern (if applicable)
11. **CDK Stack Updates** — infrastructure summary table + IAM additions
12. **Implementation Tickets** — sprint breakdown with file lists and acceptance criteria
13. **Acceptance Criteria Checklist** — ready to copy into Linear/Jira
14. **Summary of New Files** — table of every new file and its purpose

#### 📌 Implementation Status Markers

Every section heading and every implementation ticket **must include a status badge** so developers can track progress at a glance directly in the document.

**Section heading format** (add badge after the section title):

```markdown
## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->
## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->
```

**Implementation ticket format** (add badge after the ticket title):

```markdown
### AL-1 · Core Schemas (30 min) <!-- ⏳ PENDING -->
### AL-1 · Core Schemas (30 min) <!-- ✅ IMPLEMENTED -->
```

**Allowed status values**:

| Badge | Meaning |
|---|---|
| `<!-- ⏳ PENDING -->` | Not yet started — default for all new sections/tickets |
| `<!-- 🚧 IN PROGRESS -->` | Currently being implemented |
| `<!-- ✅ IMPLEMENTED -->` | Code written, TypeScript compiles, acceptance criteria met |
| `<!-- ⏭️ SKIPPED -->` | Intentionally skipped (add a reason comment inline) |

**Rules**:
- Every section (1–14) and every ticket starts with `<!-- ⏳ PENDING -->` when the document is first written.
- When a developer completes a ticket, they update the badge to `<!-- ✅ IMPLEMENTED -->` in the doc.
- When all tickets in a section are `✅ IMPLEMENTED`, update the section heading badge too.
- The **Summary of New Files** table gains a `Status` column — each row starts as `⏳` and is updated to `✅` when the file is created and compiles.
- Never remove a badge — only update its value.

---

### Step 9 — Review & Iterate

After the initial document is written, review for:

- [ ] All `safeParse` results destructured (no `parsed.success` / `parsed.data`)
- [ ] `orgId` sourced from body/query/path — not from token or `event.auth`
- [ ] All REST handlers use `apiResponse` — no raw response objects
- [ ] No raw DynamoDB SDK in handlers — all DB operations via helpers
- [ ] Entity references in comments use `entityPk`/`entitySk` (not entity-type-specific IDs)
- [ ] Comment system is entity-agnostic (`entityType` enum, not `questionId`)
- [ ] All types inferred from Zod — no manually defined types
- [ ] Every Lambda has a CloudWatch Log Group in CDK
- [ ] New permissions added to `packages/core/src/schemas/user.ts`

---

### Step 10 — Update `.clinerules/` if New Patterns Emerge

If the feature introduces a new convention not yet captured in the rules:

1. Identify which rule file it belongs to (01–08)
2. Add the rule with a ✅ correct / ❌ wrong code example
3. Keep examples concise and actionable

Common rules added during architecture sessions:
- `safeParse` destructuring → `04-backend-architecture.md`
- `orgId` sourcing → `04-backend-architecture.md`
- `apiResponse` usage → `04-backend-architecture.md`
- Entity-agnostic comment design → `03-entity-definitions.md`
- Skeleton loading states → `06-frontend-architecture.md`
