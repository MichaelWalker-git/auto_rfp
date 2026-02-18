# Implementation Plan: VRC Requirements

**Date**: February 16, 2026  
**Author**: Architecture Team  
**Status**: Draft  
**Last Updated**: February 16, 2026 (v2 — post code-review analysis)

---

## Table of Contents

1. [Requirement 1: Fix Organization Name Editing Bug](#requirement-1-fix-organization-name-editing-bug)
2. [Requirement 2: Project-Level Knowledge Base Assignment](#requirement-2-project-level-knowledge-base-assignment)
3. [Requirement 3: Multi-Organization Access (Fallback)](#requirement-3-multi-organization-access-fallback)
4. [Appendix: Identified Risks & Mitigations](#appendix-identified-risks--mitigations)

---

## Requirement 1: Fix Organization Name Editing Bug

**Priority**: High  
**Estimated Effort**: 1-2 days  
**Risk**: Low

### Problem Analysis

The organization name editing is reported as "bugged." Based on code review, the flow is:

1. **Frontend** (`SettingsContent.tsx`): Sends `PATCH /organization/edit-organization/:id` with `{ name, iconKey }`
2. **Backend** (`edit-organization.ts`): Updates DynamoDB with the new name via `UpdateCommand`
3. **Frontend** (`organization-context.tsx`): Caches organizations via SWR (`useOrganizations`)

#### Likely Root Causes

**Issue A: SWR Cache Staleness**  
After updating the org name, `SettingsContent.tsx` calls `mutate()` to refresh the local org data, but the **global** `OrganizationContext` (which uses a separate `useOrganizations()` SWR hook) is NOT refreshed. The sidebar, header, and org switcher all read from `OrganizationContext`, so they show the stale name until a full page reload.

**Issue B: `CreateEditOrganizationDialog.tsx` sends `formData` with `slug` field**  
The dialog sends `{ name, slug, description }` but the backend `UpdateOrganizationSchema` is `CreateOrganizationSchema.partial()` which does NOT include a `slug` field. The `slug` field is silently stripped by Zod validation, but the dialog's internal state management around `slug` may cause confusion.

**Issue C: Cognito `custom:orgId` attribute not updated**  
The user's Cognito token contains `custom:orgId`. If the org name is stored/referenced via Cognito attributes, those are not updated when the org is edited. However, Cognito stores `orgId` (UUID), not the name, so this is likely not the issue.

### Implementation Plan

#### Step 1: Fix SWR Cache Propagation

**File**: `web-app/components/organizations/SettingsContent.tsx`

After successful org update, trigger a global SWR revalidation so `OrganizationContext` picks up the change.

> **⚠️ Code-verified SWR key**: The `useOrganizations()` hook in `web-app/lib/hooks/use-api.ts` uses the key `['organization/organizations']` (an array key, NOT a URL string). The SWR config also has `revalidateIfStale: false` and `dedupingInterval: 60_000`, which means stale data persists for 60 seconds even after `mutate()`. We must use the exact array key and force revalidation.

```typescript
import { mutate as globalMutate } from 'swr';

// In handleUpdateOrganization, after successful response:
await mutate(); // local org data (useOrganization hook)
await globalMutate(
  (key: any) => Array.isArray(key) && key[0] === 'organization/organizations',
  undefined,
  { revalidate: true }
); // force revalidate the global org list used by OrganizationContext
```

**File**: `web-app/components/organizations/CreateEditOrganizationDialog.tsx`

Same fix — after successful edit via the dialog:

```typescript
import { mutate as globalMutate } from 'swr';

// After successful PATCH response:
await globalMutate(
  (key: any) => Array.isArray(key) && key[0] === 'organization/organizations',
  undefined,
  { revalidate: true }
);
```

> **Alternative approach**: Reduce `dedupingInterval` for the organizations hook from 60s to 5s, or set `revalidateIfStale: true`. This would make the cache less aggressive and allow `mutate()` to work more reliably. However, this affects all consumers of the hook.

#### Step 2: Verify Backend Returns Updated Data

**File**: `infrastructure/lambda/organization/edit-organization.ts`

The backend already uses `ReturnValues: 'ALL_NEW'` which returns the updated item. Verify the response includes the `name` field. ✅ Already correct.

#### Step 3: Remove `slug` from Dialog State

**File**: `web-app/components/organizations/CreateEditOrganizationDialog.tsx`

The `slug` field is managed in state but never used by the backend. Clean up:

```typescript
// Change internal state from:
const [internalFormData, setInternalFormData] = useState({
  name: '',
  slug: '',
  description: '',
});

// To:
const [internalFormData, setInternalFormData] = useState({
  name: '',
  description: '',
});
```

#### Step 4: Add Optimistic Update (Optional Enhancement)

For instant UI feedback, update the org context optimistically before the API call completes:

```typescript
// In SettingsContent.tsx handleUpdateOrganization:
await mutate(
  (current: any) => ({ ...current, name }),
  { revalidate: true }
);
```

### Testing Checklist

- [ ] Edit org name in Settings → name updates in sidebar immediately
- [ ] Edit org name via dialog → name updates in org switcher immediately
- [ ] Refresh page → name persists
- [ ] Edit org name → navigate to different page → name is correct
- [ ] Multiple users: User A edits name → User B sees update on next data fetch

---

## Requirement 2: Project-Level Knowledge Base Assignment

**Priority**: High  
**Estimated Effort**: 5-8 days  
**Risk**: Medium

### Current Architecture

```
DynamoDB Single-Table Design:
┌─────────────────────────────────────────────────────┐
│ PK              │ SK                                 │
├─────────────────┼────────────────────────────────────┤
│ KNOWLEDGE_BASE  │ {orgId}#{kbId}                     │  ← KB belongs to org
│ DOCUMENT        │ KB#{kbId}#DOC#{docId}              │  ← Doc belongs to KB
│ CONTENT_LIBRARY │ {orgId}#{kbId}#{itemId}            │  ← Q&A belongs to KB
│ PROJECT         │ {orgId}#{projectId}                │  ← Project belongs to org
│ QUESTION_FILE   │ {projectId}#{oppId}#{fileId}       │  ← File belongs to project
└─────────────────────────────────────────────────────┘
```

**Current behavior**: Knowledge bases are scoped to the **organization** level. All KBs in an org are available to all projects. The semantic search (`search.ts`) queries by `orgId` — it searches ALL documents and content library items across ALL KBs in the org.

### Proposed Architecture

Add a **many-to-many relationship** between Projects and Knowledge Bases via a new DynamoDB entity: `PROJECT_KB_LINK`.

```
New DynamoDB Entity:
┌─────────────────────────────────────────────────────┐
│ PK              │ SK                                 │
├─────────────────┼────────────────────────────────────┤
│ PROJECT_KB      │ {projectId}#{kbId}                 │  ← Link: project ↔ KB
└─────────────────────────────────────────────────────┘

Item attributes:
{
  partition_key: "PROJECT_KB",
  sort_key: "{projectId}#{kbId}",
  projectId: string,
  kbId: string,
  orgId: string,
  createdAt: string,
  createdBy: string
}
```

### Implementation Plan

#### Phase 1: Backend — Data Model & CRUD (2-3 days)

##### 1.1 Add Constants

**File**: `infrastructure/constants/organization.js` (and `.ts` equivalent)

```typescript
export const PROJECT_KB_PK = 'PROJECT_KB';
```

##### 1.2 Create Shared Schema

**File**: `shared/src/schemas/project-kb.ts`

```typescript
import { z } from 'zod';

export const ProjectKBLinkSchema = z.object({
  projectId: z.string().min(1),
  kbId: z.string().min(1),
  orgId: z.string().min(1),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});

export type ProjectKBLink = z.infer<typeof ProjectKBLinkSchema>;

export const LinkKBToProjectRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  kbId: z.string().min(1, 'Knowledge Base ID is required'),
});

export type LinkKBToProjectRequest = z.infer<typeof LinkKBToProjectRequestSchema>;

export const UnlinkKBFromProjectRequestSchema = LinkKBToProjectRequestSchema;
export type UnlinkKBFromProjectRequest = z.infer<typeof UnlinkKBFromProjectRequestSchema>;
```

##### 1.3 Create Lambda Handlers

**New files** in `infrastructure/lambda/project/`:

| File | Method | Route | Description |
|------|--------|-------|-------------|
| `link-kb.ts` | POST | `/project/link-kb` | Link a KB to a project |
| `unlink-kb.ts` | DELETE | `/project/unlink-kb` | Unlink a KB from a project |
| `get-project-kbs.ts` | GET | `/project/get-project-kbs?projectId=X` | Get all KBs linked to a project |

**`link-kb.ts`** (pseudocode):
```typescript
// 1. Validate request (projectId, kbId)
// 2. Verify project exists and belongs to org
// 3. Verify KB exists and belongs to org
// 4. PutCommand with PROJECT_KB_PK, SK = `${projectId}#${kbId}`
//    ConditionExpression: attribute_not_exists (prevent duplicates)
// 5. Return 201
```

**`get-project-kbs.ts`** (pseudocode):
```typescript
// 1. Query PROJECT_KB_PK with SK begins_with(projectId)
// 2. For each link, fetch the KB details from KNOWLEDGE_BASE_PK
// 3. Return array of KnowledgeBase objects
```

##### 1.4 Modify Semantic Search to Support Project-Scoped Queries

**File**: `infrastructure/lambda/semanticsearch/search.ts`

Current: Searches all chunks/content for an `orgId`.  
New: Accept optional `projectId` parameter. If provided, first look up linked KBs, then filter search results to only those KBs.

```typescript
// New flow:
// 1. If projectId is provided:
//    a. Query PROJECT_KB for linked kbIds
//    b. Pass kbIds as filter to Pinecone metadata query
// 2. If no projectId (backward compatible):
//    a. Search all org chunks as before
```

**File**: `infrastructure/lambda/helpers/embeddings.ts`

Modify `semanticSearchChunks()` and `semanticSearchContentLibrary()` to accept an optional `kbIds: string[]` filter parameter. Pass this as a Pinecone metadata filter:

```typescript
// Pinecone filter example:
filter: {
  orgId: { $eq: orgId },
  ...(kbIds?.length ? { kbId: { $in: kbIds } } : {}),
}
```

> **Important**: This requires that the Pinecone index stores `kbId` in the metadata for each vector. Verify this is the case in the document indexing pipeline (`index-document.ts`). If not, a backfill migration will be needed.

##### 1.5 Modify Answer Generation Pipeline

**File**: `infrastructure/lambda/answer-pipeline/` (relevant files)

When generating answers for a project's questions, pass the `projectId` to the semantic search so only linked KBs are searched.

**Backward Compatibility**: If a project has NO linked KBs, fall back to searching ALL org KBs (same as current behavior). This ensures existing projects continue to work without configuration.

#### Phase 2: Frontend — KB Assignment UI (2-3 days)

##### 2.1 Project Settings Page — KB Assignment Section

**New component**: `web-app/components/projects/ProjectKBSettings.tsx`

```
┌─────────────────────────────────────────────────────┐
│ Knowledge Bases                                      │
│                                                      │
│ Assign knowledge bases to this project. Only         │
│ assigned KBs will be used for answer generation.     │
│                                                      │
│ ┌─────────────────────────────────────────────┐     │
│ │ ☑ Company Capabilities KB          [Remove] │     │
│ │ ☑ Past Performance KB              [Remove] │     │
│ │ ☐ Technical Standards KB           [Add]    │     │
│ └─────────────────────────────────────────────┘     │
│                                                      │
│ [+ Add Knowledge Base]                               │
│                                                      │
│ ℹ If no KBs are assigned, all organization KBs      │
│   will be used (default behavior).                   │
└─────────────────────────────────────────────────────┘
```

##### 2.2 New Hooks

**File**: `web-app/lib/hooks/use-project-kbs.ts`

```typescript
// useProjectKBs(projectId) — GET linked KBs for a project
// useLinkKB() — POST to link a KB
// useUnlinkKB() — DELETE to unlink a KB
```

##### 2.3 Update Project Context

**File**: `web-app/context/project-context.tsx`

Add `linkedKBs` to the project context so downstream components (answer generation, semantic search UI) can access the project's KB scope.

#### Phase 3: Pinecone Metadata Fix — BLOCKING PREREQUISITE (2-3 days)

> **⚠️ CRITICAL FINDING (Code-Verified)**: Neither document chunks NOR content library items store `kbId` as a separate Pinecone metadata field. This is a **blocking prerequisite** for KB-scoped search.

##### 3.1 Current Pinecone Metadata (Verified)

**Document chunks** (`infrastructure/lambda/helpers/pinecone.ts` → `indexChunkToPinecone()`):
```typescript
metadata: {
  id,
  type: 'chunk',
  partition_key: document[PK_NAME],   // "DOCUMENT"
  sort_key: document[SK_NAME],        // "KB#{kbId}#DOC#{docId}" — kbId is EMBEDDED but not extractable via filter
  chunkKey,
  bucket: DOCUMENTS_BUCKET,
  createdAt: nowIso(),
}
// ❌ No separate `kbId` field — cannot filter by kbId in Pinecone queries
```

**Content library** (`infrastructure/lambda/helpers/content-library.ts` → `indexContentLibrary()`):
```typescript
metadata: {
  type: 'content_library',
  partition_key: library[PK_NAME],    // "CONTENT_LIBRARY"
  sort_key: library[SK_NAME],         // "{orgId}#{kbId}#{itemId}" — kbId is EMBEDDED
  externalId: id,
  createdAt: nowIso(),
}
// ❌ No separate `kbId` field either
```

Pinecone does NOT support substring/regex matching on metadata — only exact match (`$eq`), set membership (`$in`), and comparison operators. So we **cannot** filter by `kbId` using the current `sort_key` field.

##### 3.2 Required Fix: Add `kbId` to Pinecone Metadata

**File**: `infrastructure/lambda/helpers/pinecone.ts` — `indexChunkToPinecone()`

```typescript
// Extract kbId from the document's sort key (format: "KB#{kbId}#DOC#{docId}")
const skParts = document[SK_NAME].split('#');
const kbId = skParts.length >= 2 ? skParts[1] : undefined;

metadata: {
  id,
  type: 'chunk',
  [PK_NAME]: document[PK_NAME],
  [SK_NAME]: document[SK_NAME],
  kbId,              // ← NEW: enables filtering by knowledge base
  chunkKey,
  bucket: DOCUMENTS_BUCKET,
  createdAt: nowIso(),
}
```

**File**: `infrastructure/lambda/helpers/content-library.ts` — `indexContentLibrary()`

```typescript
// Extract kbId from the content library's sort key (format: "{orgId}#{kbId}#{itemId}")
const skParts = library[SK_NAME].split('#');
const kbId = skParts.length >= 2 ? skParts[1] : undefined;

metadata: {
  type: 'content_library',
  [PK_NAME]: library[PK_NAME],
  [SK_NAME]: library[SK_NAME],
  kbId,              // ← NEW: enables filtering by knowledge base
  externalId: id,
  createdAt: nowIso(),
}
```

##### 3.3 Backfill Existing Pinecone Vectors

Existing vectors in Pinecone do NOT have the `kbId` metadata field. Options:

**Option A: Re-index all documents (Recommended for small datasets)**
- Trigger the document pipeline for all existing documents
- Each document will be re-chunked and re-indexed with the new metadata
- Pros: Clean, guaranteed correct
- Cons: Slow for large datasets, costs embedding API calls

**Option B: Pinecone metadata update script (Faster)**
- Query all vectors in each org namespace
- For each vector, parse `kbId` from the `sort_key` metadata field
- Update the vector's metadata with the extracted `kbId`
- Pros: Fast, no re-embedding needed
- Cons: Requires Pinecone update API (supported via `upsert` with same ID + values)

**Recommended approach**: Option B for existing data, Option A going forward (new indexing code).

```typescript
// Backfill script pseudocode:
for each orgNamespace in pineconeIndex:
  vectors = fetchAllVectors(orgNamespace)
  for each vector in vectors:
    if vector.metadata.sort_key:
      kbId = extractKbIdFromSK(vector.metadata.sort_key)
      if kbId:
        updateVectorMetadata(vector.id, { ...vector.metadata, kbId })
```

##### 3.4 Update Pinecone Search to Support kbId Filter

**File**: `infrastructure/lambda/helpers/pinecone.ts` — `semanticSearchChunks()`

```typescript
export async function semanticSearchChunks(
  orgId: string,
  embedding: number[],
  k: number,
  type: string = 'chunk',
  kbIds?: string[],          // ← NEW optional parameter
): Promise<PineconeHit[]> {
  const filter: Record<string, any> = {
    type: { $eq: type },
  };
  
  // Add kbId filter if provided
  if (kbIds?.length) {
    filter.kbId = { $in: kbIds };
  }

  const results = await index.namespace(orgId).query({
    vector: embedding,
    topK: k,
    includeMetadata: true,
    includeValues: false,
    filter,
  });
  // ...
}
```

#### Phase 4: Cascade Cleanup on Delete (1 day)

##### 4.1 When a KB is Deleted → Clean Up PROJECT_KB Links

**File**: `infrastructure/lambda/knowledgebase/delete-knowledgebase.ts`

After deleting the KB, also delete all `PROJECT_KB` records that reference it:

```typescript
// Query PROJECT_KB_PK for all items where SK contains the kbId
// This requires scanning — consider adding a GSI if performance is a concern
// For now, query all PROJECT_KB items for the org and filter client-side
```

##### 4.2 When a Project is Deleted → Clean Up PROJECT_KB Links

**File**: `infrastructure/lambda/project/delete-project.ts`

After deleting the project, delete all `PROJECT_KB` records with SK `begins_with(projectId)`.

##### 4.3 Bulk Link/Unlink API (Optional Enhancement)

Add a `PUT /project/set-project-kbs` endpoint that accepts an array of kbIds and replaces all links atomically:

```typescript
// 1. Get current links for projectId
// 2. Diff with requested kbIds
// 3. Delete removed links, add new links
// 4. Use DynamoDB TransactWrite for atomicity
```

### Data Flow Diagram

```
User creates project
        │
        ▼
User assigns KBs to project (via UI)
        │
        ▼
PROJECT_KB entries created in DynamoDB
        │
        ▼
User asks question in project context
        │
        ▼
Answer pipeline reads PROJECT_KB links
        │
        ▼
Semantic search filters by linked kbIds
        │
        ▼
Only relevant KB documents/content used for answer
```

### Migration Strategy

1. **No breaking changes**: Existing projects with no KB links use all org KBs (backward compatible)
2. **No data migration needed**: New `PROJECT_KB` entity is additive
3. **Pinecone metadata**: May need backfill if `kbId` is not in vector metadata

### Testing Checklist

- [ ] Create project → assign 2 of 3 KBs → generate answer → only uses assigned KB content
- [ ] Create project → assign NO KBs → generate answer → uses all org KBs (backward compat)
- [ ] Unlink a KB from project → generate answer → unlinked KB content not used
- [ ] Link a KB → verify it appears in project settings UI
- [ ] Semantic search with project context → returns only results from linked KBs

---

## Requirement 3: Multi-Organization Access (Fallback)

**Priority**: Medium (only if Requirement 2 is not viable for VRC)  
**Estimated Effort**: 8-12 days  
**Risk**: High — significant changes to auth model

### Current Architecture

```
User ↔ Organization: 1-to-1 (enforced by Cognito custom:orgId)

DynamoDB:
┌──────────┬──────────────────────────────┐
│ PK       │ SK                            │
├──────────┼──────────────────────────────┤
│ USER     │ ORG#{orgId}#USER#{userId}     │  ← User belongs to ONE org
└──────────┴──────────────────────────────┘

Cognito User Attributes:
- custom:orgId  → single org ID (used in JWT token)
- custom:role   → single role (ADMIN/EDITOR/VIEWER/BILLING)
```

**Problem**: A user can only belong to one organization. The `custom:orgId` in Cognito is a single value. The RBAC middleware reads `orgId` from the JWT token claims.

### Proposed Architecture

#### Option A: Multiple DynamoDB Membership Records (Recommended)

Keep Cognito simple (no `custom:orgId` in token). Instead, manage org membership entirely in DynamoDB.

```
New model: User can have MULTIPLE membership records

DynamoDB:
┌──────────┬──────────────────────────────┐
│ PK       │ SK                            │
├──────────┼──────────────────────────────┤
│ USER     │ ORG#{orgId1}#USER#{userId}    │  ← Membership in Org 1
│ USER     │ ORG#{orgId2}#USER#{userId}    │  ← Membership in Org 2
└──────────┴──────────────────────────────┘

Each membership record has its own role:
{
  orgId: "org-1",
  userId: "user-123",
  role: "ADMIN",        // role in org-1
  email: "user@example.com",
  ...
}
{
  orgId: "org-2",
  userId: "user-123",
  role: "VIEWER",       // role in org-2
  email: "user@example.com",
  ...
}
```

#### Option B: Org Selection via API Header (Simpler Auth)

Keep the current DynamoDB model but add an `X-Org-Id` header to API requests. The frontend sends the currently selected org ID with each request.

### Implementation Plan (Option A — Recommended)

#### Phase 1: Backend Auth Changes (4-5 days)

##### 1.1 Remove `custom:orgId` from Cognito Token Dependency

**File**: `infrastructure/lambda/middleware/rbac-middleware.ts`

Current: Reads `orgId` from `claims['custom:orgId']`  
New: Read `orgId` from request header `X-Org-Id` or query parameter

```typescript
// In authContextMiddleware:
const orgId = 
  event.headers?.['x-org-id'] ||           // from header
  event.queryStringParameters?.orgId ||      // from query param
  claims['custom:orgId'];                    // fallback to token (backward compat)
```

##### 1.2 Add Org Membership Verification

**File**: `infrastructure/lambda/middleware/rbac-middleware.ts`

In `orgMembershipMiddleware`, verify the user actually belongs to the requested org:

```typescript
// Query DynamoDB: USER PK, SK = ORG#{orgId}#USER#{userId}
// If not found → 403 Forbidden
// If found → set role from the membership record
```

##### 1.3 Create "Get My Organizations" Endpoint

**New file**: `infrastructure/lambda/user/get-my-organizations.ts`

> **⚠️ CRITICAL FINDING (Code-Verified)**: The DynamoDB table has **NO Global Secondary Indexes (GSIs)**. The USER SK format is `ORG#{orgId}#USER#{userId}`. To find all orgs for a given userId, we CANNOT use `begins_with` on the SK because the orgId comes before the userId in the key. This means a naive query would require scanning ALL USER items.

**Required: Add a GSI** to `infrastructure/lib/database-stack.ts`:

```typescript
this.tableName.addGlobalSecondaryIndex({
  indexName: 'byUserId',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'partition_key', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

Then the "Get My Organizations" endpoint can efficiently query:
```typescript
// Query GSI 'byUserId' where userId = authenticatedUserId AND partition_key = 'USER'
// Returns all membership records for this user across all orgs
// For each record, fetch org details from ORG PK
```

**Alternative (no GSI)**: Store a separate `USER_ORGS` record:
```
PK: USER_ORGS, SK: {userId}
orgs: ["org-1", "org-2", ...]
```
This avoids a GSI but requires maintaining a denormalized list.

##### 1.4 Update User Invitation Flow

**File**: `infrastructure/lambda/user/create-user.ts`

Current: Creates a Cognito user + one DynamoDB record  
New: 
- If user already exists in Cognito (different org), skip Cognito creation
- Create a new DynamoDB membership record for the new org
- Handle the case where the same email is invited to multiple orgs

##### 1.5 Update Cognito User Creation

Remove the hard dependency on `custom:orgId` in Cognito. Either:
- Don't set it at all (use DynamoDB for org resolution)
- Set it to the user's "primary" org (first org they were invited to)

#### Phase 2: Frontend Changes (3-4 days)

##### 2.1 Update Organization Context

**File**: `web-app/context/organization-context.tsx`

Current: Reads orgs from `/organization/get-organizations` (returns ALL orgs for admins)  
New: For non-admin users, use `/user/get-my-organizations` to get only orgs they belong to

##### 2.2 Update Organization Switcher

**File**: `web-app/components/OrganizationSwitcher.tsx`

Allow all users (not just admins) to switch between their organizations.

##### 2.3 Add `X-Org-Id` Header to All API Calls

**File**: `web-app/lib/auth/auth-fetcher.ts`

Automatically include the current org ID in all API requests:

```typescript
const headers = {
  ...options.headers,
  'X-Org-Id': getCurrentOrgId(),
};
```

##### 2.4 Update Auth Provider

**File**: `web-app/components/AuthProvider.tsx`

Handle the case where a user has multiple orgs. On login, determine which org to show first (last used, or first in list).

#### Phase 3: Migration (1-2 days)

##### 3.1 Cognito Attribute Migration

For existing users with `custom:orgId`, ensure their DynamoDB membership records exist. This should already be the case since user records are in DynamoDB.

##### 3.2 Frontend Token Handling

Ensure the frontend doesn't break if `custom:orgId` is missing from the token (for users invited to multiple orgs where the token org doesn't match the selected org).

### Security Considerations

1. **Always verify org membership server-side** — never trust the `X-Org-Id` header alone
2. **Rate limit org switching** to prevent enumeration attacks
3. **Audit log** org switches for compliance
4. **Data isolation** — ensure queries always filter by the verified orgId

### Testing Checklist

- [ ] User in 1 org → behaves exactly as before (backward compat)
- [ ] User invited to 2nd org → sees both in org switcher
- [ ] User switches org → all data (projects, KBs, etc.) reflects new org
- [ ] User with ADMIN in org-1, VIEWER in org-2 → permissions correct per org
- [ ] User removed from org → can no longer access that org's data
- [ ] API calls with wrong `X-Org-Id` → 403 Forbidden

---

## Priority & Sequencing (Updated)

```
Week 1:
├── Req 1: Fix Org Name Bug (1-2 days) ← START HERE
├── Req 2: Phase 3 - Pinecone metadata fix (2-3 days) ← MUST START EARLY (blocking)
│   ├── Add kbId to indexing code
│   ├── Write & run backfill script
│   └── Verify backfill completeness
└── Req 2: Phase 1 - Backend data model & CRUD (2-3 days, parallel)

Week 2:
├── Req 2: Phase 2 - Frontend KB assignment UI (2-3 days)
├── Req 2: Phase 4 - Cascade cleanup on delete (1 day)
└── Req 2: Integration testing & QA

Week 3-4 (only if Req 2 doesn't satisfy VRC):
├── Req 3: Add GSI to DynamoDB (requires careful deployment)
├── Req 3: Phase 1 - Backend auth changes
├── Req 3: Phase 2 - Frontend changes
└── Req 3: Phase 3 - Migration & testing
```

> **Note**: Pinecone metadata fix (Phase 3) is moved to Week 1 because it's a **blocking prerequisite** for KB-scoped search. The backfill script should run early to ensure all existing vectors have `kbId` metadata before the feature goes live.

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Project-KB is many-to-many | A project may need multiple KBs; a KB may serve multiple projects |
| Fallback to all-org KBs when none linked | Backward compatibility; zero-config for existing projects |
| `PROJECT_KB` as separate DynamoDB entity | Clean separation; easy to query; no schema changes to existing entities |
| Multi-org via DynamoDB membership (not Cognito) | Cognito custom attributes are limited; DynamoDB is more flexible |
| `X-Org-Id` header for org context | Standard pattern; works with existing API Gateway setup |
| Add `kbId` to Pinecone metadata (not rely on SK parsing) | Pinecone only supports exact/set metadata filters, not substring matching |
| GSI `byUserId` for multi-org user lookup | Current SK format `ORG#{orgId}#USER#{userId}` prevents efficient user→orgs query |
| Backfill via metadata update (not re-indexing) | Avoids costly re-embedding; Pinecone supports metadata-only updates via upsert |

---

## Appendix: Identified Risks & Mitigations

### Risk Matrix

| # | Risk | Severity | Likelihood | Requirement | Mitigation |
|---|------|----------|------------|-------------|------------|
| 1 | **SWR 60s dedup interval** prevents immediate cache refresh after org name edit | Medium | High | Req 1 | Use SWR matcher function with `{ revalidate: true }` to force bypass dedup |
| 2 | **Pinecone has no `kbId` in metadata** — KB-scoped search is impossible without code + data changes | **Critical** | Confirmed | Req 2 | Add `kbId` to indexing code + backfill existing vectors (Phase 3) |
| 3 | **Pinecone backfill may miss vectors** if new documents are indexed during backfill | Medium | Medium | Req 2 | Deploy new indexing code FIRST, then run backfill. New vectors will have `kbId`; backfill catches old ones |
| 4 | **No DynamoDB GSI exists** — "get my orgs" query requires full table scan | **Critical** | Confirmed | Req 3 | Add `byUserId` GSI to database stack. Alternative: denormalized `USER_ORGS` record |
| 5 | **Cognito `adminCreateUser` fails** if email already exists (multi-org invitation) | High | High | Req 3 | Catch `UsernameExistsException`, skip Cognito creation, only create DynamoDB membership record |
| 6 | **JWT token contains stale `custom:orgId`** after org switch | High | High | Req 3 | Don't rely on token `orgId` for multi-org users; use `X-Org-Id` header + server-side verification |
| 7 | **KB deletion doesn't clean up PROJECT_KB links** | Medium | Medium | Req 2 | Add cascade delete in `delete-knowledgebase.ts` (Phase 4) |
| 8 | **Project deletion doesn't clean up PROJECT_KB links** | Medium | Medium | Req 2 | Add cascade delete in `delete-project.ts` (Phase 4) |
| 9 | **Content library SK format differs** from document SK format for kbId extraction | Low | Confirmed | Req 2 | Document SK: `KB#{kbId}#DOC#{docId}` (index 1). Content library SK: `{orgId}#{kbId}#{itemId}` (index 1). Both use index 1 after split — but verify edge cases with UUIDs containing `#` |
| 10 | **Adding GSI to production DynamoDB** may cause temporary performance impact | Medium | Low | Req 3 | GSI creation is online (no downtime) but consumes write capacity during backfill. Schedule during low-traffic period |

### Open Questions

1. **Req 2**: Should the bulk `set-project-kbs` API be implemented in v1, or is individual link/unlink sufficient?
2. **Req 2**: When a KB is unlinked from a project mid-pipeline (answer generation in progress), should we abort or complete with the old KB set?
3. **Req 3**: Should we support different roles per org (ADMIN in org-1, VIEWER in org-2), or keep a single global role?
4. **Req 3**: What happens to a user's session/token when they're removed from an org they're currently viewing?
5. **General**: Should we add an audit log for KB assignments and org membership changes?
