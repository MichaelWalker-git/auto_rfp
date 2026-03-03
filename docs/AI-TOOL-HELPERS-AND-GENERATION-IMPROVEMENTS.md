# AI Tool Helpers & Generation Logic Improvements

> Design document for improving DynamoDB tool helpers used by AI during document and brief generation.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [New Entity: Organization Primary Contact](#3-new-entity-organization-primary-contact)
4. [New: DynamoDB AI Tool Helpers](#4-new-dynamodb-ai-tool-helpers)
5. [New & Updated AI Tool Definitions](#5-new--updated-ai-tool-definitions)
6. [Updated Document Generation Logic](#6-updated-document-generation-logic)
7. [Updated Brief Generation Logic](#7-updated-brief-generation-logic)
8. [Audit Trail for AI Tool Usage](#8-audit-trail-for-ai-tool-usage)
9. [File Changes Summary](#9-file-changes-summary)
10. [Implementation Plan](#10-implementation-plan)

---

## 1. Problem Statement

### 1.1 Raw DynamoDB Access in AI Tools (No Type Safety)

The `get_organization_context` tool in `document-tools.ts` performs raw DynamoDB queries inline with extensive `any` casts:

```typescript
// Current: raw DynamoDB access with `any` everywhere
const org = orgRes.Item as Record<string, unknown> | undefined;
if (org) {
  if (org.name) parts.push(`Company Name: ${org.name}`);
}
const project = await getProjectById(projectId);
if ((project as any).name) parts.push(`Project Name: ${(project as any).name}`);
members.forEach((m: any) => { ... });
```

**Impact:** No compile-time safety, easy to miss fields, hard to maintain.

### 1.2 No Primary Contact on Organization

The `OrganizationItem` schema has no structured primary contact fields (signatory name, title, phone, email). These are critical for Cover Letters, Commitment Statements, and any document requiring a real signature block. Currently the generation worker passes `orgContact` and `userContact` as ad-hoc fields in the SQS message — there is no persistent, editable source of truth for the organization's primary contact.

**Impact:** Generated documents use placeholder values or rely on the submitting user's profile, which may not be the correct signatory.

### 1.3 Brief Generation Has No Tool Support

The executive brief worker (`exec-brief-worker.ts`) pre-loads ALL context upfront and calls Claude once per section with no dynamic querying. Claude cannot ask for more specific data mid-generation.

**Impact:** If the pre-loaded KB context doesn't contain what's needed for a specific section, output quality suffers. The scoring section is especially affected — it needs cross-section data but can only access what was pre-loaded.

### 1.4 Limited Tool Set

Current tools (4 total) are only used in document generation:

| Tool | Used In | Limitation |
|------|---------|------------|
| `search_past_performance` | Document gen only | Not available during brief gen |
| `search_knowledge_base` | Document gen only | Not available during brief gen |
| `get_qa_answers` | Document gen only | Simple keyword matching, no embeddings |
| `get_organization_context` | Document gen only | Raw DynamoDB, `any` types, no primary contact |

Missing tools that would improve quality:
- **Executive brief analysis** — AI can't access pre-analyzed opportunity intelligence during document gen
- **Content library** — AI can't search pre-approved content snippets
- **Deadline information** — AI can't look up specific deadlines
- **Existing brief sections** — Scoring can't dynamically access prior section results

### 1.5 No Audit Trail for AI Tool Usage

When Claude calls a tool during generation, there is no record of which tools were invoked, what data was retrieved, or whether the retrieval succeeded. This makes it impossible to audit AI behavior, debug quality issues, or track data access patterns.

### 1.6 `COST_SAVING` Flag Disables Tools

The `COST_SAVING` env flag currently disables KB queries in brief generation. This flag is a blunt instrument that silently degrades output quality. It should be removed — tools should always be available, with cost managed through model selection and token limits instead.

---

## 2. Architecture Overview

### Current Architecture

```
┌─────────────────────────────────────────────────────┐
│ Document Generation Worker                          │
│  1. Pre-fetch ALL context (solicitation, QA, KB,    │
│     past perf, content lib, exec brief)             │
│  2. Build system + user prompts with all context    │
│  3. Call Claude with 4 tools (max 3 rounds)         │
│  4. Tools query: past perf, KB, QA, org context     │
│  5. Parse JSON response → save document             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Brief Generation Worker                             │
│  1. Pre-fetch solicitation + KB context             │
│  2. Build system + user prompts with all context    │
│  3. Call Claude ONCE (no tools)                     │
│  4. Parse JSON response → save section              │
└─────────────────────────────────────────────────────┘
```

### Proposed Architecture

```
┌──────────────────────────────────────────────────────────────┐
│           Organization Primary Contact (NEW ENTITY)          │
│  packages/core/src/schemas/org-contact.ts                    │
│  apps/functions/src/handlers/org-contact/ (CRUD REST)        │
│  Stored in DynamoDB: PK=ORG_CONTACT_PK, SK={orgId}           │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  DB Tool Helpers Layer (NEW)                  │
│  apps/functions/src/helpers/db-tool-helpers.ts               │
│                                                              │
│  Typed, reusable functions returning AI-formatted strings:   │
│  fetchOrgDetails · fetchOrgPrimaryContact · fetchProjectInfo │
│  fetchTeamMembers · fetchBriefAnalysis · fetchDeadlines      │
│  fetchContentLibrary · fetchRfpDocuments                     │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              AI Tool Definitions & Executors                  │
│                                                              │
│  document-tools.ts (UPDATED)     brief-tools.ts (NEW)        │
│  7 tools for doc gen             6 tools for brief gen       │
│  + search_past_perf              + search_knowledge_base     │
│  + search_kb                     + search_past_perf          │
│  + get_qa_answers                + get_org_context           │
│  + get_org_context (refactored)  + get_content_library       │
│  + get_exec_brief_analysis (NEW) + get_brief_sections (NEW)  │
│  + get_content_library (NEW)     + get_deadlines (NEW)       │
│  + get_deadlines (NEW)                                       │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              Generation Workers (UPDATED)                     │
│                                                              │
│  generate-document-worker.ts     exec-brief-worker.ts        │
│  Reduced pre-fetch               Add tool-use loop           │
│  7 tools, 3 rounds               6 tools, 2 rounds           │
│  Audit logs every tool call      Audit logs every tool call  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. New Entity: Organization Primary Contact

### 3.1 Why a Separate Entity

The primary contact (signatory) for proposals is distinct from the organization's general contact info and from the submitting user's profile. It represents the executive who signs proposals — typically a VP, CEO, or Contracts Manager. This person:

- May not be a system user
- May change per contract type or opportunity
- Needs to be editable by org admins independently of org settings
- Must be reliably available to AI tools during document generation

Storing it as a separate entity (rather than fields on `OrganizationItem`) keeps the org schema clean and allows independent CRUD without touching org settings.

### 3.2 Schema: `packages/core/src/schemas/org-contact.ts`

```typescript
import { z } from 'zod';

export const OrgPrimaryContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  title: z.string().trim().min(1, 'Title is required'),
  email: z.string().email('Must be a valid email'),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export type OrgPrimaryContact = z.infer<typeof OrgPrimaryContactSchema>;

export const OrgPrimaryContactItemSchema = OrgPrimaryContactSchema.extend({
  partition_key: z.string().optional(),
  sort_key: z.string().optional(),
  orgId: z.string().min(1),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type OrgPrimaryContactItem = z.infer<typeof OrgPrimaryContactItemSchema>;

// For CRUD endpoints
export const CreateOrgPrimaryContactSchema = OrgPrimaryContactSchema;
export type CreateOrgPrimaryContactDTO = z.infer<typeof CreateOrgPrimaryContactSchema>;

export const UpdateOrgPrimaryContactSchema = OrgPrimaryContactSchema.partial();
export type UpdateOrgPrimaryContactDTO = z.infer<typeof UpdateOrgPrimaryContactSchema>;

// API response
export const OrgPrimaryContactResponseSchema = z.object({
  contact: OrgPrimaryContactItemSchema,
});
export type OrgPrimaryContactResponse = z.infer<typeof OrgPrimaryContactResponseSchema>;
```

### 3.3 DynamoDB Storage

```
PK = ORG_CONTACT_PK  (new constant: 'ORG_CONTACT')
SK = {orgId}
```

One record per organization. Upsert on create/update (no versioning needed).

Add to `apps/functions/src/constants/organization.ts`:
```typescript
export const ORG_CONTACT_PK = 'ORG_CONTACT';
```

### 3.4 REST Endpoints

**File:** `apps/functions/src/handlers/org-contact/`

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/organizations/{orgId}/contact` | `get-org-contact.ts` | Get primary contact |
| `PUT` | `/organizations/{orgId}/contact` | `upsert-org-contact.ts` | Create or update primary contact |
| `DELETE` | `/organizations/{orgId}/contact` | `delete-org-contact.ts` | Remove primary contact |

**`get-org-contact.ts`:**
```typescript
// GET /organizations/{orgId}/contact
// Returns 200 with contact or 404 if not set
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.pathParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const contact = await getOrgPrimaryContact(orgId);
  if (!contact) return apiResponse(404, { message: 'No primary contact configured for this organization' });

  return apiResponse(200, { contact });
};
```

**`upsert-org-contact.ts`:**
```typescript
// PUT /organizations/{orgId}/contact
// Body: CreateOrgPrimaryContactDTO
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.pathParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const { success, data, error } = CreateOrgPrimaryContactSchema.safeParse(JSON.parse(event.body ?? '{}'));
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const contact = await upsertOrgPrimaryContact(orgId, data, event.auth?.userId ?? 'system');
  return apiResponse(200, { contact });
};
```

**`delete-org-contact.ts`:**
```typescript
// DELETE /organizations/{orgId}/contact
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.pathParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  await deleteOrgPrimaryContact(orgId);
  return apiResponse(204, {});
};
```

### 3.5 Helper Functions: `apps/functions/src/helpers/org-contact.ts`

```typescript
import { OrgPrimaryContactItem, OrgPrimaryContactItemSchema } from '@auto-rfp/core';
import { getItem, putItem, deleteItem } from '@/helpers/db';
import { ORG_CONTACT_PK } from '@/constants/organization';
import type { CreateOrgPrimaryContactDTO } from '@auto-rfp/core';

export const getOrgPrimaryContact = async (orgId: string): Promise<OrgPrimaryContactItem | null> =>
  getItem<OrgPrimaryContactItem>(ORG_CONTACT_PK, orgId);

export const upsertOrgPrimaryContact = async (
  orgId: string,
  dto: CreateOrgPrimaryContactDTO,
  updatedBy: string,
): Promise<OrgPrimaryContactItem> =>
  putItem<OrgPrimaryContactItem>(ORG_CONTACT_PK, orgId, { ...dto, orgId, updatedBy }, true);

export const deleteOrgPrimaryContact = async (orgId: string): Promise<void> => {
  await deleteItem(ORG_CONTACT_PK, orgId);
};
```

### 3.6 Impact on Document Generation

The `get_organization_context` tool will now include primary contact data:

```
=== ORGANIZATION ===
Company Name: Acme Federal Solutions
Address: 1234 K Street NW, Washington DC 20005
CAGE Code: 7XYZ1
NAICS Codes: 541511, 541512

=== PRIMARY CONTACT (PROPOSAL SIGNATORY) ===
Name: Jane Smith
Title: Vice President, Contracts
Email: jsmith@acmefederal.com
Phone: (202) 555-0100

=== PROJECT ===
Project Name: DISA Cloud Migration RFP

=== TEAM MEMBERS ===
• John Doe | Program Manager | jdoe@acmefederal.com
• ...
```

The `orgContact` / `userContact` fields in `DocumentGenerationMessage` can be **removed** — the tool now fetches this data directly from DynamoDB.

---

## 4. New: DynamoDB AI Tool Helpers

### File: `apps/functions/src/helpers/db-tool-helpers.ts`

These helpers wrap DynamoDB queries with proper types and return **formatted strings** ready for AI consumption. No `any` casts. No raw DynamoDB access in tool executors.

### 4.1 `fetchOrganizationDetails`

```typescript
export const fetchOrganizationDetails = async (orgId: string): Promise<string>
```

- Queries `PK = ORG_PK`, `SK = ORG#${orgId}` using `getItem<OrganizationItem>`
- Returns formatted string: name, description, website, address, phone, email, CAGE, DUNS/UEI, NAICS codes, business type, set-aside, slug
- Returns `''` if not found

### 4.2 `fetchOrgPrimaryContact`

```typescript
export const fetchOrgPrimaryContact = async (orgId: string): Promise<string>
```

- Calls `getOrgPrimaryContact(orgId)` from `helpers/org-contact.ts`
- Returns formatted string: name, title, email, phone, address
- Returns `''` if no contact configured

### 4.3 `fetchProjectDetails`

```typescript
export const fetchProjectDetails = async (projectId: string): Promise<string>
```

- Calls `getProjectById(projectId)` from `helpers/project.ts`
- Types result as `DBProjectItem` — no `any` casts
- Returns formatted string: project name, description, org name
- Returns `''` if not found

### 4.4 `fetchTeamMembers`

```typescript
export const fetchTeamMembers = async (orgId: string, limit = 10): Promise<string>
```

- Calls `getOrgMembers(orgId)` from `helpers/user.ts`
- Types members as `UserItem[]` from `@auto-rfp/core` — no `any` casts
- Returns formatted bullet list: name, title, email, phone, role
- Returns `''` if no members

### 4.5 `fetchExecutiveBriefAnalysis`

```typescript
export const fetchExecutiveBriefAnalysis = async (
  projectId: string,
  opportunityId?: string,
  sections?: BriefSectionName[],
): Promise<string>
```

- Calls `getExecutiveBriefByProjectId(projectId, opportunityId)`
- Extracts and formats requested sections (or all COMPLETE sections)
- Formats each section's `.data` into readable text:
  - **summary**: title, agency, NAICS, contract type, scope
  - **requirements**: overview, must-have requirements, evaluation factors, deliverables
  - **risks**: high/critical risks with mitigations, incumbent info
  - **contacts**: role, name, email
  - **deadlines**: submission deadline, other key dates
  - **scoring**: decision, composite score, recommendation, justification
- Returns `''` if no brief found

### 4.6 `fetchDeadlineInfo`

```typescript
export const fetchDeadlineInfo = async (
  projectId: string,
  opportunityId?: string,
): Promise<string>
```

- Queries deadline records from DynamoDB (deadline PK/SK pattern)
- Falls back to executive brief deadlines section
- Returns formatted list: deadline type, date/time, description
- Highlights submission deadline prominently
- Returns `''` if no deadlines found

### 4.7 `fetchContentLibraryMatches`

```typescript
export const fetchContentLibraryMatches = async (
  orgId: string,
  query: string,
  limit = 5,
): Promise<string>
```

- Gets embedding for query via `getEmbedding(query)`
- Calls `semanticSearchContentLibrary(orgId, embedding, limit * 2)`
- Loads matched `ContentLibraryItem` records from DynamoDB using PK/SK from Pinecone metadata
- Filters by minimum score threshold (0.40)
- Returns formatted list: question, answer, relevance score
- Returns `''` if no matches

### 4.8 `fetchExistingRfpDocuments`

```typescript
export const fetchExistingRfpDocuments = async (
  projectId: string,
  opportunityId?: string,
): Promise<string>
```

- Queries RFP document records from DynamoDB
- Returns formatted list: document type, title, status, creation date
- Useful for compliance matrix generation (knowing what volumes exist)
- Returns `''` if no documents found

---

## 5. New & Updated AI Tool Definitions

### 5.1 Updated Document Tools (`document-tools.ts`)

#### Refactored: `get_organization_context`

The executor is replaced entirely — no more raw DynamoDB, no `any`:

```typescript
const executeGetOrganizationContext = async (orgId: string, projectId: string): Promise<string> => {
  const [orgDetails, primaryContact, projectDetails, teamMembers] = await Promise.all([
    fetchOrganizationDetails(orgId),
    fetchOrgPrimaryContact(orgId),
    fetchProjectDetails(projectId),
    fetchTeamMembers(orgId, 10),
  ]);

  const parts = [orgDetails, primaryContact, projectDetails, teamMembers].filter(Boolean);
  return parts.length
    ? parts.join('\n\n')
    : 'No organization context available. Use placeholder values like [Company Name], [Contact Name], [Title], [Email], [Phone].';
};
```

The tool description is updated to mention primary contact:

```typescript
{
  name: 'get_organization_context',
  description:
    'Retrieve organization, primary contact (proposal signatory), project, and team member ' +
    'information in a single call. Use this when generating Cover Letters, Commitment Statements, ' +
    'Team Qualifications, or any section requiring real company/personnel details. ' +
    'Includes: company name, address, CAGE/DUNS, primary contact name/title/email/phone, ' +
    'team member names and roles, and project name.',
  // ... input_schema unchanged
}
```

#### New: `get_executive_brief_analysis`

```typescript
{
  name: 'get_executive_brief_analysis',
  description:
    'Retrieve pre-analyzed executive brief data for this opportunity. ' +
    'Returns structured analysis including: opportunity summary, key requirements, ' +
    'identified risks, contacts, deadlines, and bid/no-bid scoring. ' +
    'Use this when you need pre-analyzed intelligence about the opportunity ' +
    'to inform your document content, especially for Executive Summary, ' +
    'Understanding of Requirements, and Risk Management sections.',
  input_schema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['summary', 'requirements', 'risks', 'contacts', 'deadlines', 'scoring'],
        },
        description: 'Which brief sections to retrieve. Omit to get all completed sections.',
      },
    },
    required: [],
  },
}
```

**Executor:** `fetchExecutiveBriefAnalysis(projectId, opportunityId, sections)`

#### New: `get_content_library`

```typescript
{
  name: 'get_content_library',
  description:
    'Search the organization\'s content library for pre-approved content snippets. ' +
    'The content library contains vetted Q&A pairs and boilerplate text approved for proposals. ' +
    'Use this when you need standard language for certifications, compliance statements, ' +
    'company descriptions, or recurring proposal themes.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query. Example: "ISO 9001 certification" or "small business status"',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of content items to return (1–5). Default: 3.',
      },
    },
    required: ['query'],
  },
}
```

**Executor:** `fetchContentLibraryMatches(orgId, query, limit)`

#### New: `get_deadlines`

```typescript
{
  name: 'get_deadlines',
  description:
    'Retrieve deadline information for this opportunity. ' +
    'Returns submission deadlines, Q&A periods, site visit dates, and other key dates. ' +
    'Use this when generating Cover Letters, Project Plans, or any section referencing specific dates.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
}
```

**Executor:** `fetchDeadlineInfo(projectId, opportunityId)`

#### Updated Tool Count: 4 → 7

| # | Tool | Status |
|---|------|--------|
| 1 | `search_past_performance` | Existing (unchanged) |
| 2 | `search_knowledge_base` | Existing (unchanged) |
| 3 | `get_qa_answers` | Existing (unchanged) |
| 4 | `get_organization_context` | Existing (**refactored** — uses helpers, adds primary contact) |
| 5 | `get_executive_brief_analysis` | **NEW** |
| 6 | `get_content_library` | **NEW** |
| 7 | `get_deadlines` | **NEW** |

### 5.2 New Brief Tools (`brief-tools.ts`)

```typescript
export const BRIEF_TOOLS = [
  SEARCH_KNOWLEDGE_BASE_TOOL,      // shared definition
  SEARCH_PAST_PERFORMANCE_TOOL,    // shared definition
  GET_ORG_CONTEXT_TOOL,            // shared definition
  GET_CONTENT_LIBRARY_TOOL,        // shared definition
  GET_COMPLETED_BRIEF_SECTIONS_TOOL, // brief-specific
  GET_DEADLINES_TOOL,              // shared definition
] as const;
```

#### New: `get_completed_brief_sections` (brief-only)

```typescript
{
  name: 'get_completed_brief_sections',
  description:
    'Retrieve data from already-completed sections of this executive brief. ' +
    'Use this in the scoring section to access summary, requirements, risks, contacts, ' +
    'and deadlines data generated in prior steps. ' +
    'Only COMPLETE sections are returned — in-progress or failed sections are excluded.',
  input_schema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['summary', 'requirements', 'risks', 'contacts', 'deadlines', 'pastPerformance'],
        },
        description: 'Which sections to retrieve.',
      },
    },
    required: ['sections'],
  },
}
```

**Executor:** Reads the brief from DynamoDB, returns formatted data for requested COMPLETE sections.

#### Brief Tool Dispatcher

```typescript
export const executeBriefTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId: string;
}): Promise<ToolResult>
```

---

## 6. Updated Document Generation Logic

### 6.1 Update `executeDocumentTool` Signature

Add `opportunityId` (needed for brief analysis and deadlines):

```typescript
// Before
export const executeDocumentTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  qaPairs: QaPair[];
}): Promise<ToolResult>

// After
export const executeDocumentTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;  // required — no optional
  qaPairs: QaPair[];
}): Promise<ToolResult>
```

### 6.2 Remove `orgContact` / `userContact` from SQS Message

Since `get_organization_context` now fetches directly from DynamoDB, these fields are no longer needed in the generation message:

```typescript
// Before
export interface DocumentGenerationMessage {
  orgId: string;
  projectId: string;
  opportunityId?: string;
  documentType: string;
  templateId?: string;
  documentId: string;
  orgContact?: OrgContactInfo;   // REMOVE
  userContact?: UserContactInfo; // REMOVE
}

// After
export interface DocumentGenerationMessage {
  orgId: string;
  projectId: string;
  opportunityId: string;  // required — not optional
  documentType: string;
  templateId?: string;
  documentId: string;
}
```

Also remove `formatContactContext()` and the contact context prepend logic from `generate-document-worker.ts`.

### 6.3 Reduce Pre-Fetched Context Budgets

Since AI can dynamically query for specific data via tools, reduce pre-fetched context budgets in `document-context.ts`:

```typescript
// Before: 26,000 chars total
const TOTAL_CONTEXT_BUDGET = 26_000;
const DEFAULT_BUDGETS = { execBrief: 8_000, kb: 8_000, pastPerf: 6_000, contentLib: 4_000 };

// After: 18,000 chars total (tools fill the gap on demand)
const TOTAL_CONTEXT_BUDGET = 18_000;
const DEFAULT_BUDGETS = { execBrief: 6_000, kb: 5_000, pastPerf: 4_000, contentLib: 3_000 };
```

The pre-fetched context serves as a "primer" — enough for Claude to understand what's available and formulate good tool queries.

### 6.4 New `invokeClaudeWithTools` Helper

Extract the 100+ line tool-use loop from `generate-document-worker.ts` into a reusable helper:

**File:** `apps/functions/src/helpers/bedrock-tool-loop.ts`

```typescript
export interface InvokeClaudeWithToolsArgs<S extends SchemaLike> {
  modelId: string;
  system: string;
  user: string;
  tools: ReadonlyArray<ToolDefinition>;
  toolExecutor: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<ToolResult>;
  outputSchema: S;
  maxTokens?: number;
  temperature?: number;
  maxToolRounds?: number;
}

/**
 * Invoke Claude with a tool-use loop.
 * Handles: initial request → tool execution → result injection → repeat → final parse.
 * Returns the parsed, validated output.
 */
export const invokeClaudeWithTools = async <S extends SchemaLike>(
  args: InvokeClaudeWithToolsArgs<S>,
): Promise<ReturnType<S['parse']>>
```

**Benefits:**
- Eliminates duplicated tool loop code
- Reusable across document gen, brief gen, and future AI features
- Consistent error recovery and logging

---

## 7. Updated Brief Generation Logic

### 7.1 Remove `COST_SAVING` Flag

The `COST_SAVING` env flag is removed from `exec-brief-worker.ts`. Tools are always enabled. Cost is managed through:
- Model selection (use cheaper models for simpler sections)
- `maxToolRounds` limit (2 rounds max for brief sections)
- Token limits per section (unchanged)

```typescript
// Remove entirely:
const COST_SAVING = requireEnv('COST_SAVING', 'true') === 'true';

// Remove all conditional blocks:
const kbMatches = COST_SAVING ? [] : await queryCompanyKnowledgeBase(...);
```

### 7.2 Add Tool-Use Loop to Brief Worker

Transform section handlers from single-call to tool-use loop using `invokeClaudeWithTools`:

**Before:**
```typescript
async function runSummary(job: Job): Promise<void> {
  const { solicitationText } = await loadSolicitationForBrief(brief);
  const kbMatches = await queryCompanyKnowledgeBase(orgId, solicitationText, topK);
  const kbText = kbParts.join('\n\n');
  const data = await invokeClaudeJson({ system, user, outputSchema: QuickSummarySchema });
  await markSectionComplete({ ... });
}
```

**After:**
```typescript
async function runSummary(job: Job): Promise<void> {
  const { solicitationText } = await loadSolicitationForBrief(brief);
  // Minimal KB primer — Claude uses tools to pull specific data
  const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

  const data = await invokeClaudeWithTools({
    modelId: BEDROCK_MODEL_ID,
    system: await getSummarySystemPrompt(orgId),
    user: await useSummaryUserPrompt(orgId, solicitationText, kbPrimer, ...),
    tools: BRIEF_TOOLS,
    toolExecutor: (toolName, toolInput, toolUseId) =>
      executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
    outputSchema: QuickSummarySchema,
    maxTokens: 1200,
    maxToolRounds: 2,
  });

  await markSectionComplete({ ... });
}
```

### 7.3 Which Brief Sections Get Tools

| Section | Tools? | Max Rounds | Rationale |
|---------|--------|-----------|-----------|
| `summary` | ✅ Yes | 2 | Can search KB for company capabilities to enrich summary |
| `deadlines` | ❌ No | 0 | Pure extraction from solicitation text — tools add no value |
| `requirements` | ✅ Yes | 2 | Can search KB to validate capability coverage, search content library |
| `contacts` | ❌ No | 0 | Pure extraction from solicitation text — tools add no value |
| `risks` | ✅ Yes | 2 | Can search past performance for risk mitigation examples |
| `scoring` | ✅ Yes | 2 | Must access completed brief sections, search past performance |

### 7.4 Replace Inline KB Loading with `loadKbPrimer`

The duplicated KB loading pattern across `runSummary`, `runRequirements`, `runScoring` is replaced with a single shared helper:

```typescript
/**
 * Load a small KB primer (top N chunks) to give Claude initial context.
 * Claude uses tools to pull deeper, more specific KB data as needed.
 */
const loadKbPrimer = async (orgId: string, solicitation: string, topK = 3): Promise<string>
```

This replaces the 20-line inline KB loading block repeated in each section handler.

---

## 8. Audit Trail for AI Tool Usage

### 8.1 New Audit Actions

Add to `AuditActionSchema` in `packages/core/src/schemas/audit.ts`:

```typescript
// AI Tool actions (add to existing enum)
'AI_TOOL_CALLED',
'AI_TOOL_FAILED',
```

Add to `AuditResourceSchema`:
```typescript
'ai_tool',  // add to existing enum
```

### 8.2 Tool Usage Audit Log Entry

Every tool call (in both document and brief generation) writes an audit log entry:

```typescript
// Logged on every tool invocation
{
  logId: uuid(),
  timestamp: nowIso(),
  userId: 'system',
  userName: 'system',
  organizationId: orgId,
  action: 'AI_TOOL_CALLED',
  resource: 'ai_tool',
  resourceId: documentId,  // or executiveBriefId for brief gen
  changes: {
    after: {
      toolName,
      toolInput,
      resultLength: content.length,
      resultEmpty: content.length === 0,
      durationMs,
    },
  },
  ipAddress: '0.0.0.0',
  userAgent: 'system',
  result: 'success',
}

// On tool failure:
{
  action: 'AI_TOOL_FAILED',
  result: 'failure',
  errorMessage: err.message,
  changes: { after: { toolName, toolInput } },
}
```

### 8.3 Where Audit Logging Happens

Audit logging is added to the **tool dispatcher** level — not inside individual tool executors. This ensures every tool call is logged regardless of which tool is invoked:

**In `executeDocumentTool`:**
```typescript
export const executeDocumentTool = async (args: { ... }): Promise<ToolResult> => {
  const start = Date.now();
  let content: string;
  let result: 'success' | 'failure' = 'success';
  let errorMessage: string | undefined;

  try {
    // ... existing switch statement
  } catch (err) {
    result = 'failure';
    errorMessage = (err as Error).message;
    content = `Error: ${errorMessage}`;
  }

  const durationMs = Date.now() - start;

  // Non-blocking audit log
  logToolUsage({
    orgId: args.orgId,
    resourceId: args.documentId,  // add documentId to args
    toolName: args.toolName,
    toolInput: args.toolInput,
    resultLength: content.length,
    resultEmpty: content.length === 0,
    durationMs,
    result,
    errorMessage,
  }).catch(err => console.warn('Failed to write tool audit log:', err.message));

  return { tool_use_id: args.toolUseId, content };
};
```

**`logToolUsage` helper** (in `db-tool-helpers.ts` or a new `tool-audit.ts`):
```typescript
export const logToolUsage = async (params: {
  orgId: string;
  resourceId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  resultLength: number;
  resultEmpty: boolean;
  durationMs: number;
  result: 'success' | 'failure';
  errorMessage?: string;
}): Promise<void>
```

This calls `writeAuditLog()` from `helpers/audit-log.ts` with the HMAC secret from SSM.

### 8.4 What Gets Logged

| Field | Value |
|-------|-------|
| `action` | `AI_TOOL_CALLED` or `AI_TOOL_FAILED` |
| `resource` | `ai_tool` |
| `resourceId` | `documentId` (doc gen) or `executiveBriefId` (brief gen) |
| `changes.after.toolName` | e.g. `search_past_performance` |
| `changes.after.toolInput` | Sanitized input (no PII) |
| `changes.after.resultLength` | Number of chars returned |
| `changes.after.resultEmpty` | Whether tool returned empty result |
| `changes.after.durationMs` | Tool execution time |
| `result` | `success` or `failure` |
| `errorMessage` | Error message if failed |

### 8.5 Querying Tool Usage

Existing `queryAuditLogs` endpoint supports filtering by `action = 'AI_TOOL_CALLED'` and `resource = 'ai_tool'`. No new endpoints needed.

---

## 9. File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `packages/core/src/schemas/org-contact.ts` | Zod schema for OrgPrimaryContact entity |
| `apps/functions/src/helpers/org-contact.ts` | DynamoDB helpers for org primary contact |
| `apps/functions/src/handlers/org-contact/get-org-contact.ts` | GET endpoint |
| `apps/functions/src/handlers/org-contact/upsert-org-contact.ts` | PUT endpoint |
| `apps/functions/src/handlers/org-contact/delete-org-contact.ts` | DELETE endpoint |
| `apps/functions/src/helpers/db-tool-helpers.ts` | Typed DynamoDB query helpers for AI tools |
| `apps/functions/src/helpers/brief-tools.ts` | Brief-specific AI tool definitions and executor |
| `apps/functions/src/helpers/bedrock-tool-loop.ts` | Reusable tool-use loop for Claude invocations |

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/schemas/audit.ts` | Add `AI_TOOL_CALLED`, `AI_TOOL_FAILED` actions; add `ai_tool` resource |
| `packages/core/src/schemas/organization.ts` | No changes (primary contact is a separate entity) |
| `packages/core/src/index.ts` | Export new `org-contact` schemas |
| `apps/functions/src/constants/organization.ts` | Add `ORG_CONTACT_PK = 'ORG_CONTACT'` |
| `apps/functions/src/helpers/document-tools.ts` | Refactor `get_organization_context` executor; add 3 new tools; add `opportunityId` + `documentId` to dispatcher args |
| `apps/functions/src/helpers/document-generation-queue.ts` | Remove `OrgContactInfo`, `UserContactInfo`; make `opportunityId` required |
| `apps/functions/src/handlers/rfp-document/generate-document-worker.ts` | Remove contact context logic; pass `opportunityId` + `documentId` to tool executor; use `invokeClaudeWithTools` |
| `apps/functions/src/handlers/rfp-document/create-rfp-document.ts` | Remove `orgContact`/`userContact` from enqueue call |
| `apps/functions/src/handlers/brief/exec-brief-worker.ts` | Remove `COST_SAVING` flag; add tool-use loop to summary, requirements, risks, scoring; replace inline KB loading with `loadKbPrimer` |
| `apps/functions/src/helpers/document-context.ts` | Reduce pre-fetch budgets |
| `packages/infra/api/` | Add 3 new org-contact routes to API Gateway |

### Test Files (New)

| File | Description |
|------|-------------|
| `apps/functions/src/helpers/org-contact.test.ts` | Tests for org contact helpers |
| `apps/functions/src/handlers/org-contact/get-org-contact.test.ts` | Tests for GET endpoint |
| `apps/functions/src/handlers/org-contact/upsert-org-contact.test.ts` | Tests for PUT endpoint |
| `apps/functions/src/helpers/db-tool-helpers.test.ts` | Tests for all DB tool helpers |
| `apps/functions/src/helpers/brief-tools.test.ts` | Tests for brief tool definitions and executor |
| `apps/functions/src/helpers/bedrock-tool-loop.test.ts` | Tests for the reusable tool-use loop |

---

## 10. Implementation Plan

### Phase 1: Organization Primary Contact (Foundation)
1. Add `OrgPrimaryContactSchema` to `packages/core`
2. Add `ORG_CONTACT_PK` constant
3. Create `helpers/org-contact.ts`
4. Create 3 REST handlers (`get`, `upsert`, `delete`)
5. Wire routes in CDK API stack
6. Add tests
7. **No changes to generation workers** — purely additive

### Phase 2: DB Tool Helpers + Audit Schema
1. Create `helpers/db-tool-helpers.ts` with all typed helpers
2. Create `helpers/bedrock-tool-loop.ts`
3. Add `AI_TOOL_CALLED`, `AI_TOOL_FAILED`, `ai_tool` to audit schema
4. Add tests for helpers
5. **No changes to existing workers** — purely additive

### Phase 3: Document Generation Improvements
1. Refactor `document-tools.ts`:
   - Replace `executeGetOrganizationContext` with helpers (includes primary contact)
   - Add 3 new tools
   - Add `opportunityId` + `documentId` to dispatcher
   - Add audit logging to dispatcher
2. Remove `orgContact`/`userContact` from `DocumentGenerationMessage`
3. Update `generate-document-worker.ts`:
   - Remove contact context logic
   - Pass `opportunityId` + `documentId` to tool executor
   - Use `invokeClaudeWithTools` helper
4. Reduce pre-fetch budgets in `document-context.ts`
5. Update tests

### Phase 4: Brief Generation Improvements
1. Create `helpers/brief-tools.ts`
2. Update `exec-brief-worker.ts`:
   - Remove `COST_SAVING` flag entirely
   - Add tool-use loop to `runSummary`, `runRequirements`, `runRisks`, `runScoring`
   - Replace inline KB loading with `loadKbPrimer`
   - Add audit logging via `executeBriefTool` dispatcher
3. Update tests

### Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| `opportunityId` required in `DocumentGenerationMessage` | Any caller that omits `opportunityId` will fail | Update all `enqueueDocumentGeneration` call sites to pass `opportunityId` |
| Remove `orgContact`/`userContact` from message | Callers that set these fields will have them ignored | Remove from all `enqueueDocumentGeneration` call sites |
| Remove `COST_SAVING` env var | Brief gen always uses tools | Remove from `.env`, CDK env vars, and any CI/CD config |
| `executeDocumentTool` requires `documentId` | Tool dispatcher callers must pass `documentId` | Update `generate-document-worker.ts` |

---

## Appendix: Shared Type Definitions

### `ToolDefinition` (move to `types/tool.ts`)

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
}
```

Both `document-tools.ts` and `brief-tools.ts` import from `types/tool.ts`.

### Types used in `db-tool-helpers.ts`

```typescript
import type {
  OrganizationItem,
  OrgPrimaryContactItem,
  UserItem,
  ExecutiveBriefItem,
  ContentLibraryItem,
} from '@auto-rfp/core';
import type { DBProjectItem } from '@/types/project';
import type { BriefSectionName } from '@/helpers/executive-opportunity-brief';
```

All helpers use types from `@auto-rfp/core` or existing typed interfaces — zero `any` casts.
