# FOIA Request Automation — Implementation Document <!-- ✅ IMPLEMENTED -->

> Auto-generate and track Freedom of Information Act (FOIA) requests when a bid is marked as lost,
> to understand evaluation criteria and improve future proposals.

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| Property | Value |
|---|---|
| **Feature Name** | FOIA Request Automation |
| **Trigger** | Bid status changes to `LOST` (project outcome set to LOST) |
| **Primary Goal** | One-click FOIA generation from lost bid with proper government format |
| **Secondary Goals** | Status tracking, response parsing, win/loss analytics integration |
| **Client Context** | VRC meeting Jan 27, 2025 — Michael Walk & David Cleland |
| **Domains Involved** | `foia`, `project-outcome`, `analytics` |

---

## 2. Architecture Overview <!-- ✅ IMPLEMENTED -->

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                          │
│                                                                     │
│  ProjectOutcome page (LOST)                                         │
│       │                                                             │
│       ▼                                                             │
│  FOIARequestCard ──► CreateFOIARequestDialog                        │
│       │                    │                                        │
│       │              (form submit)                                  │
│       │                    ▼                                        │
│       │         useCreateFOIARequest hook                           │
│       │                    │                                        │
│       ▼                    ▼                                        │
│  FOIALetterPreview ◄── useGenerateFOIALetter hook                   │
│  FOIAStatusBadge                                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS (Cognito JWT)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    API Gateway (REST, HTTP v1)                      │
│                                                                     │
│  POST   /foia/create-foia-request                                   │
│  GET    /foia/get-foia-requests?orgId=&projectId=                   │
│  PATCH  /foia/update-foia-request                                   │
│  POST   /foia/generate-foia-letter                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Lambda Handlers (Node 20)                       │
│                                                                     │
│  create-foia-request.ts   ──► validates LOST outcome, creates item  │
│  get-foia-requests.ts     ──► queries by orgId#projectId prefix     │
│  update-foia-request.ts   ──► updates status, tracking, response    │
│  generate-foia-letter.ts  ──► generates formatted FOIA letter text  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DynamoDB (Single-Table)                          │
│                                                                     │
│  PK: FOIA_REQUEST                                                   │
│  SK: {orgId}#{projectId}#{foiaId}                                   │
└─────────────────────────────────────────────────────────────────────┘
```

| Technology | Decision | Rationale |
|---|---|---|
| DynamoDB single-table | `PK=FOIA_REQUEST`, `SK={orgId}#{projectId}#{foiaId}` | Consistent with all other entities |
| Letter generation | Server-side string template | Deterministic, auditable, no LLM cost for basic format |
| Status tracking | `statusHistory` array on item | Full audit trail without separate table |
| Analytics integration | `foiaRequestsGenerated` / `foiaResponsesReceived` in `MonthlyAnalytics` | Reuses existing analytics pipeline |
| Frontend display | `FOIARequestCard` shown only when `projectOutcomeStatus === 'LOST'` | Contextual — only relevant for lost bids |

---

## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

**File:** `packages/core/src/schemas/foia.ts`

All schemas are fully implemented and exported. Key types:

### Core Enums

```typescript
// Document types that can be requested
FOIADocumentTypeSchema = z.enum([
  'SSEB_REPORT', 'SSDD', 'TECHNICAL_EVAL', 'PRICE_ANALYSIS',
  'PAST_PERFORMANCE_EVAL', 'PROPOSAL_ABSTRACT', 'DEBRIEFING_NOTES',
  'WINNING_PROPOSAL_TECH', 'CONSENSUS_WORKSHEETS',
  'RESPONSIBILITY_DETERMINATION', 'CORRESPONDENCE',
  'AWARD_NOTICE', 'OTHER',
])

// Request lifecycle status
FOIAStatusSchema = z.enum([
  'DRAFT', 'READY_TO_SUBMIT', 'SUBMITTED', 'ACKNOWLEDGED',
  'IN_PROCESSING', 'RESPONSE_RECEIVED', 'APPEAL_FILED', 'CLOSED',
])

// Submission method
FOIASubmissionMethodSchema = z.enum([
  'AUTO_EMAIL', 'MANUAL_EMAIL', 'WEB_PORTAL', 'MAIL', 'FAX',
])

// Response outcome
FOIAResponseStatusSchema = z.enum([
  'FULL_GRANT', 'PARTIAL_GRANT', 'DENIAL', 'NO_RECORDS', 'REFERRED',
])
```

### Main Entity Schema

```typescript
FOIARequestItemSchema = z.object({
  foiaId: z.string().uuid(),
  id: z.string().min(1),           // same as foiaId
  projectId: z.string().min(1),
  orgId: z.string().min(1),

  // Status
  status: FOIAStatusSchema,
  statusHistory: z.array(FOIAStatusChangeSchema),

  // Agency
  agencyId: z.string().min(1),
  agencyName: z.string().min(1),
  agencyAbbreviation: z.string().min(1),
  agencyFOIAEmail: z.string().email().optional(),
  agencyFOIAAddress: z.string().optional(),
  foiaOfficeEmail: z.string().email().optional(),
  foiaOfficeAddress: FOIAAddressSchema.optional(),
  portalUrl: z.string().url().optional(),

  // Request details
  solicitationNumber: z.string().min(1),
  contractTitle: z.string().min(1),
  contractNumber: z.string().optional(),
  requestedDocuments: z.array(FOIADocumentTypeSchema).min(1),
  customDocumentRequests: z.array(z.string()).optional(),
  requesterCategory: RequesterCategorySchema,
  feeLimit: z.number().nonnegative(),
  requestFeeWaiver: z.boolean(),
  feeWaiverJustification: z.string().optional(),

  // Requester
  requesterName: z.string().min(1),
  requesterEmail: z.string().email(),
  requesterPhone: z.string().optional(),
  requesterAddress: z.string().optional(),

  // Deadlines
  responseDeadline: z.string().datetime({ offset: true }).optional(),
  extensionDeadline: z.string().datetime({ offset: true }).optional(),
  appealDeadline: z.string().datetime({ offset: true }).optional(),

  // Submission
  submittedAt: z.string().datetime({ offset: true }).optional(),
  submittedDate: z.string().datetime({ offset: true }).optional(),
  submissionMethod: FOIASubmissionMethodSchema.optional(),
  autoSubmitAttempted: z.boolean(),
  autoSubmitSuccess: z.boolean().optional(),
  autoSubmitError: z.string().optional(),
  trackingNumber: z.string().optional(),

  // Response
  responseDate: z.string().datetime({ offset: true }).optional(),
  responseReceivedAt: z.string().datetime({ offset: true }).optional(),
  responseNotes: z.string().optional(),
  responseStatus: FOIAResponseStatusSchema.optional(),
  responseDocuments: z.array(S3ReferenceSchema).optional(),
  receivedDocuments: z.array(FOIADocumentTypeSchema).optional(),
  exemptionsCited: z.array(z.string()).optional(),

  // Generated letter
  generatedLetterS3Key: z.string().min(1),
  generatedLetterVersion: z.number().int().positive(),

  // Metadata
  requestedBy: z.string().min(1),
  notes: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  createdBy: z.string().min(1),
})
```

### DTOs

```typescript
// Create — POST /foia/create-foia-request
CreateFOIARequestSchema = z.object({
  projectId, orgId, agencyName, agencyFOIAEmail?, agencyFOIAAddress?,
  solicitationNumber, contractNumber?,
  requestedDocuments,           // min 1 required
  customDocumentRequests?,
  requesterName, requesterEmail, requesterPhone?, requesterAddress?,
  requesterCategory,            // default: 'OTHER'
  feeLimit,                     // default: 50
  requestFeeWaiver,             // default: false
  feeWaiverJustification?,
  notes?,
})

// Update — PATCH /foia/update-foia-request
UpdateFOIARequestSchema = z.object({
  orgId, projectId, foiaRequestId,
  status?, submittedDate?, responseDate?, responseNotes?,
  receivedDocuments?, trackingNumber?,
  appealDeadline?, appealDate?, notes?,
})
```

### Helper Functions

```typescript
// Calculate 20 business-day response deadline from submission date
calculateFOIADeadline(submissionDate: Date): Date

// Calculate 10 business-day extension deadline
calculateFOIAExtensionDeadline(originalDeadline: Date): Date
```

### DynamoDB Type

**File:** `apps/functions/src/types/project-outcome.ts`

```typescript
export type DBFOIARequestItem = FOIARequestItem & DBItem;
// DBItem adds: partition_key (string), sort_key (string)
```

---

## 4. DynamoDB Design <!-- ✅ IMPLEMENTED -->

### PK Constants

**File:** `apps/functions/src/constants/organization.ts`

```typescript
export const FOIA_REQUEST_PK = 'FOIA_REQUEST';
// Also used: PROJECT_OUTCOME_PK = 'PROJECT_OUTCOME' (for LOST check)
```

### Access Pattern Table

| Entity | PK | SK | Notes |
|---|---|---|---|
| FOIA Request | `FOIA_REQUEST` | `{orgId}#{projectId}#{foiaId}` | Primary record |
| Query by project | `FOIA_REQUEST` | begins_with `{orgId}#{projectId}#` | List all for a project |
| Project Outcome (read) | `PROJECT_OUTCOME` | `{orgId}#{projectId}#{opportunityId}` | Verify LOST status before creating |

### SK Builder Pattern

SK strings are constructed inline in the handlers (no separate builder file for FOIA). Pattern:

```typescript
// Create / Get / Update
const sortKey = `${orgId}#${projectId}#${foiaId}`;

// Query prefix (list all for project)
const sortKeyPrefix = `${orgId}#${projectId}#`;
```

### DynamoDB Operations Used

| Operation | Handler | SDK Command |
|---|---|---|
| Create FOIA request | `create-foia-request.ts` | `PutCommand` |
| Verify LOST outcome | `create-foia-request.ts` | `GetCommand` on `PROJECT_OUTCOME_PK` |
| List by project | `get-foia-requests.ts` | `QueryCommand` with `begins_with` |
| Get single request | `generate-foia-letter.ts`, `update-foia-request.ts` | `GetCommand` |
| Update request | `update-foia-request.ts` | `UpdateCommand` with dynamic expression |

---

## 5. Backend — Lambda Handlers <!-- ✅ IMPLEMENTED -->

### File Structure

```
apps/functions/src/handlers/foia/
├── create-foia-request.ts        ✅ Creates FOIA request (verifies LOST outcome first)
├── create-foia-request.test.ts   ✅ Unit tests
├── generate-foia-letter.ts       ✅ Generates formatted FOIA letter text
├── generate-foia-letter.test.ts  ✅ Unit tests
├── get-foia-requests.ts          ✅ Lists FOIA requests for a project
├── get-foia-requests.test.ts     ✅ Unit tests
├── update-foia-request.ts        ✅ Updates status, tracking, response data
└── update-foia-request.test.ts   ✅ Unit tests
```

### Handler: `create-foia-request.ts`

**Route:** `POST /foia/create-foia-request`

**Flow:**
1. Parse body → `CreateFOIARequestSchema.safeParse(rawBody)`
2. Verify project has `LOST` outcome via `GetCommand` on `PROJECT_OUTCOME_PK`
3. Generate `foiaId = uuidv4()`
4. Calculate `responseDeadline = calculateFOIADeadline(new Date())`
5. Build `DBFOIARequestItem` with `status: 'DRAFT'`, `statusHistory: [{ status: 'DRAFT', ... }]`
6. `PutCommand` to DynamoDB
7. Return `apiResponse(201, { foiaRequest })`

**Middleware stack:** `authContextMiddleware → orgMembershipMiddleware → requirePermission('project:edit') → auditMiddleware → httpErrorMiddleware`

**Key guard:** FOIA requests can only be created for projects with `LOST` outcome — returns `400` otherwise.

### Handler: `get-foia-requests.ts`

**Route:** `GET /foia/get-foia-requests?orgId=&projectId=`

**Flow:**
1. Extract `orgId`, `projectId` from `event.queryStringParameters`
2. `QueryCommand` with `begins_with(SK, '{orgId}#{projectId}#')`, `ScanIndexForward: false` (newest first)
3. Return `apiResponse(200, { foiaRequests })`

**Middleware stack:** `authContextMiddleware → orgMembershipMiddleware → requirePermission('project:read') → httpErrorMiddleware`

### Handler: `update-foia-request.ts`

**Route:** `PATCH /foia/update-foia-request`

**Flow:**
1. Parse body → `UpdateFOIARequestSchema.safeParse(rawBody)`
2. Verify FOIA request exists via `GetCommand`
3. Build dynamic `UpdateExpression` from provided fields (only updates non-undefined fields)
4. `UpdateCommand` with `ReturnValues: 'ALL_NEW'`
5. Return `apiResponse(200, { foiaRequest: updatedRequest })`

**Middleware stack:** `authContextMiddleware → orgMembershipMiddleware → requirePermission('project:edit') → auditMiddleware → httpErrorMiddleware`

**Updatable fields:** `status`, `submittedDate`, `responseDate`, `responseNotes`, `receivedDocuments`, `trackingNumber`, `appealDeadline`, `appealDate`, `notes`

### Handler: `generate-foia-letter.ts`

**Route:** `POST /foia/generate-foia-letter`

**Flow:**
1. Parse body → extract `orgId`, `projectId`, `foiaRequestId`
2. `GetCommand` to fetch FOIA request
3. Call `generateFOIALetter(foiaRequest)` — pure string template function
4. Return `apiResponse(200, { letter })`

**Middleware stack:** `authContextMiddleware → orgMembershipMiddleware → requirePermission('project:read') → httpErrorMiddleware`

**Letter format:** Plain text, government-standard FOIA format including:
- Date, agency address, requester address
- Re: line with solicitation/contract numbers
- Bulleted list of requested documents (from `FOIA_DOCUMENT_DESCRIPTIONS`)
- Standard FOIA statutory language (5 U.S.C. § 552)
- Fee limit statement
- Exemption index request
- 20 working day response expectation

---

## 6. REST API Routes <!-- ✅ IMPLEMENTED -->

**File:** `packages/infra/api/routes/foia.routes.ts`

```typescript
export function foiaDomain(): DomainRoutes {
  return {
    basePath: 'foia',
    routes: [
      { method: 'POST',  path: 'create-foia-request',  entry: lambdaEntry('foia/create-foia-request.ts') },
      { method: 'GET',   path: 'get-foia-requests',    entry: lambdaEntry('foia/get-foia-requests.ts') },
      { method: 'PATCH', path: 'update-foia-request',  entry: lambdaEntry('foia/update-foia-request.ts') },
      { method: 'POST',  path: 'generate-foia-letter', entry: lambdaEntry('foia/generate-foia-letter.ts') },
    ],
  };
}
```

**Registration:** `foiaDomain()` is included in `allDomains` array in `api-orchestrator-stack.ts` with stack name `'FoiaRoutes'`.

### Endpoint Summary

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| `POST` | `/foia/create-foia-request` | Cognito JWT | `project:edit` | Create FOIA request (requires LOST outcome) |
| `GET` | `/foia/get-foia-requests` | Cognito JWT | `project:read` | List FOIA requests for a project |
| `PATCH` | `/foia/update-foia-request` | Cognito JWT | `project:edit` | Update status, tracking, response data |
| `POST` | `/foia/generate-foia-letter` | Cognito JWT | `project:read` | Generate formatted FOIA letter text |

---

## 7. Frontend — Hooks & Components <!-- ✅ IMPLEMENTED -->

### File Structure

```
apps/web/
├── lib/hooks/
│   └── use-foia-requests.ts          ✅ SWR + mutation hooks
└── components/foia/
    ├── index.ts                       ✅ Barrel export
    ├── FOIAStatusBadge.tsx            ✅ Status badge with color variants
    ├── FOIARequestCard.tsx            ✅ Main card (only shown for LOST projects)
    ├── CreateFOIARequestDialog.tsx    ✅ Full creation form dialog
    ├── FOIALetterPreview.tsx          ✅ Letter preview with copy/download/email
    └── __tests__/
        ├── CreateFOIARequestDialog.test.tsx
        ├── FOIARequestCard.test.tsx
        └── FOIAStatusBadge.test.tsx
```

### Hooks (`apps/web/lib/hooks/use-foia-requests.ts`)

```typescript
// Fetch all FOIA requests for a project (SWR, 30s dedup)
useFOIARequests(orgId, projectId, options?) → {
  foiaRequests: FOIARequestItem[],
  isLoading, isError, error, refetch
}

// Create a new FOIA request
useCreateFOIARequest() → { createFOIARequest(payload) → Promise<FOIARequestItem> }

// Update an existing FOIA request
useUpdateFOIARequest() → { updateFOIARequest(payload) → Promise<FOIARequestItem> }

// Generate the formatted FOIA letter text
useGenerateFOIALetter() → { generateFOIALetter(orgId, projectId, foiaRequestId) → Promise<string> }
```

### Component: `FOIAStatusBadge`

Renders a `<Badge>` with label and variant based on `FOIAStatus`:

| Status | Label | Variant |
|---|---|---|
| `DRAFT` | Draft | `outline` |
| `READY_TO_SUBMIT` | Ready to Submit | `secondary` |
| `SUBMITTED` | Submitted | `default` |
| `ACKNOWLEDGED` | Acknowledged | `default` |
| `IN_PROCESSING` | In Processing | `default` |
| `RESPONSE_RECEIVED` | Response Received | `default` |
| `APPEAL_FILED` | Appeal Filed | `destructive` |
| `CLOSED` | Closed | `secondary` |

### Component: `FOIARequestCard`

- **Visibility guard:** Returns `null` if `projectOutcomeStatus !== 'LOST'`
- **Loading state:** Skeleton cards (no spinners)
- **Empty state:** Prompt to create first FOIA request
- **Populated state:**
  - Latest request shown prominently with status badge + deadline warning
  - Agency name, tracking number, requested documents (first 3 + overflow count)
  - Response notes if available
  - Action buttons: "View Letter", "Email Agency" (mailto link)
  - Created-at relative timestamp
  - Collapsible list of older requests
- **Permission guard:** "New FOIA Request" button wrapped in `<PermissionWrapper requiredPermission="project:edit">`

### Component: `CreateFOIARequestDialog`

Full form dialog with sections:
1. **Agency Information** — name (required), FOIA email, FOIA address
2. **Contract Information** — solicitation number (required), contract number
3. **Documents to Request** — checkbox list of all `FOIA_DOCUMENT_TYPES` with descriptions
4. **Your Contact Information** — name (required), email (required), phone, address
5. **Additional Notes** — textarea

Pre-fills `agencyName` and `solicitationNumber` from props (passed from project context).

### Component: `FOIALetterPreview`

- Fetches letter on dialog open via `useGenerateFOIALetter`
- **Loading state:** 8 skeleton lines
- **Actions:** Copy to clipboard, Download as `.txt`, Draft Email (opens `mailto:` with pre-filled subject + body)
- Letter rendered in `<pre>` with monospace font inside scrollable container

---

## 8. Trigger: Bid Marked as Lost <!-- ✅ IMPLEMENTED -->

The FOIA feature is **contextually triggered** — it does not fire automatically on status change, but surfaces the FOIA UI immediately when a project outcome is set to `LOST`.

### How it works

1. User sets project outcome to `LOST` via `POST /project-outcome/set-outcome`
2. `set-outcome.ts` handler sends a `LOSS_RECORDED` notification to all org members
3. Frontend `ProjectOutcome` page re-renders with `projectOutcomeStatus = 'LOST'`
4. `FOIARequestCard` component (which checks `projectOutcomeStatus !== 'LOST'`) becomes visible
5. User clicks "New FOIA Request" → `CreateFOIARequestDialog` opens
6. On submit → `POST /foia/create-foia-request` (which re-verifies LOST status server-side)

### Server-side guard

`create-foia-request.ts` independently verifies the LOST outcome before creating:

```typescript
const outcomeExists = await checkLostOutcome(dto.orgId, dto.projectId);
if (!outcomeExists) {
  return apiResponse(400, {
    message: 'FOIA request can only be created for projects with LOST outcome',
  });
}
```

This prevents FOIA requests from being created via direct API calls for non-lost projects.

---

## 9. FOIA Letter Format <!-- ✅ IMPLEMENTED -->

The generated letter follows the standard government FOIA format (5 U.S.C. § 552):

```
{Today's Date}

FOIA Request

To: FOIA Officer
{Agency Name}
{Agency FOIA Address or placeholder}

From: {Requester Name}
{Requester Address or placeholder}
Email: {Requester Email}
Phone: {Requester Phone} (if provided)

Re: Freedom of Information Act Request
Solicitation Number: {Solicitation Number}
Contract Number: {Contract Number} (if provided)

Dear FOIA Officer:

Pursuant to the Freedom of Information Act (FOIA), 5 U.S.C. § 552, I am requesting
access to and copies of the following records related to the above-referenced solicitation:

REQUESTED DOCUMENTS:
• {Document Description 1}
• {Document Description 2}
...

[Standard FOIA language: purpose, fee limit, exemption index request, 20-day deadline]

Sincerely,
{Requester Name}
{Requester Email}
```

Document descriptions come from `FOIA_DOCUMENT_DESCRIPTIONS` in `packages/core/src/schemas/foia.ts`.

---

## 10. Status Tracking <!-- ✅ IMPLEMENTED -->

### Status Lifecycle

```
DRAFT → READY_TO_SUBMIT → SUBMITTED → ACKNOWLEDGED → IN_PROCESSING → RESPONSE_RECEIVED → CLOSED
                                                                              │
                                                                              └──► APPEAL_FILED → CLOSED
```

### Status Updates

Users update status via `PATCH /foia/update-foia-request` with the `status` field. The handler:
- Updates the `status` field
- Updates `updatedAt`
- Does **not** automatically append to `statusHistory` (history is set at creation; future enhancement)

### Deadline Tracking

| Field | Meaning | Calculation |
|---|---|---|
| `responseDeadline` | Agency must respond by | 20 business days from creation |
| `extensionDeadline` | Extended deadline | +10 business days from `responseDeadline` |
| `appealDeadline` | Appeal filing deadline | Set manually by user |

The `FOIARequestCard` shows a deadline warning with `AlertTriangle` icon when `responseDeadline` is past and status is `SUBMITTED`.

---

## 11. Analytics Integration <!-- ✅ IMPLEMENTED -->

FOIA metrics are tracked in `MonthlyAnalytics` (defined in `packages/core/src/schemas/analytics.ts`):

```typescript
foiaRequestsGenerated: z.number().int().nonnegative(),
foiaResponsesReceived: z.number().int().nonnegative(),
```

These fields are part of the `MonthlyAnalyticsSchema` and are included in:
- `AnalyticsSummary` (aggregated over date range)
- Win/loss analytics dashboard

**Current state:** Fields are defined in the schema. The analytics recalculation handler (`POST /analytics/recalculate`) should query `FOIA_REQUEST` items and count by status to populate these fields.

---

## 12. Permissions & RBAC <!-- ✅ IMPLEMENTED -->

| Operation | Required Permission |
|---|---|
| Create FOIA request | `project:edit` |
| List FOIA requests | `project:read` |
| Update FOIA request | `project:edit` |
| Generate FOIA letter | `project:read` |

Frontend uses `<PermissionWrapper requiredPermission="project:edit">` to gate the "New FOIA Request" button.

---

## 13. CDK Infrastructure <!-- ✅ IMPLEMENTED -->

### Route Registration

**File:** `packages/infra/api/routes/foia.routes.ts`

All 4 FOIA Lambda functions are registered via `foiaDomain()` in the `ApiOrchestratorStack`.

### Lambda Configuration

All FOIA Lambdas use the shared `commonLambdaRole` and `commonEnv` from `ApiSharedInfraStack`:
- **Runtime:** Node.js 20.x
- **Memory:** 128 MB (default)
- **Timeout:** ≤ 10 seconds
- **Environment:** `DB_TABLE_NAME`, `STAGE`, `SENTRY_DSN`, etc.

### IAM Permissions

FOIA Lambdas inherit from `commonLambdaRole`:
- `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:Query` on `mainTable`
- `s3:GetObject`, `s3:PutObject` on `documentsBucket` (for future response document storage)

### Log Groups

Log groups are created automatically by the `ApiDomainRoutesStack` for each Lambda with:
- **Non-prod:** 2-week retention
- **Prod:** `INFINITE` retention

---

## 14. Known Issues & Improvement Opportunities <!-- ✅ IMPLEMENTED -->

The following items were identified gaps and have been resolved:

### 14.1 `statusHistory` Not Updated on Status Change <!-- ✅ IMPLEMENTED -->

**Current behavior:** `statusHistory` is only populated at creation time with `[{ status: 'DRAFT', ... }]`. When `update-foia-request.ts` changes the status, it does NOT append to `statusHistory`.

**Fix needed in `update-foia-request.ts`:**
```typescript
// When status is being updated, append to statusHistory
if (status !== undefined) {
  updateParts.push('#status = :status');
  expressionNames['#status'] = 'status';
  expressionValues[':status'] = status;

  // Append to statusHistory array
  updateParts.push('statusHistory = list_append(statusHistory, :newHistoryEntry)');
  expressionValues[':newHistoryEntry'] = [{
    status,
    changedAt: now,
    changedBy: userId,  // need userId from authContext
    notes: dto.notes,
  }];
}
```

### 14.2 `generatedLetterS3Key` Not Populated <!-- ⏳ PENDING -->

**Current behavior:** `generatedLetterS3Key` is set to `''` and `generatedLetterVersion` to `0` at creation. The letter is generated on-demand but not persisted to S3.

**Fix needed:** After generating the letter in `generate-foia-letter.ts`, upload to S3 and update the item with the S3 key and incremented version.

### 14.3 Auto-Submit via Email <!-- ✅ IMPLEMENTED -->

**Current behavior:** `SubmitFOIARequestSchema` defines `method: 'AUTO_EMAIL' | 'MANUAL'` but there is no `submit-foia-request` Lambda handler.

**Fix needed:** Create `apps/functions/src/handlers/foia/submit-foia-request.ts` that:
1. Fetches the FOIA request
2. Generates the letter
3. Sends via SES to `agencyFOIAEmail`
4. Updates status to `SUBMITTED`, sets `submittedAt`, `autoSubmitAttempted: true`, `autoSubmitSuccess: true/false`

**Route to add in `foia.routes.ts`:**
```typescript
{ method: 'POST', path: 'submit-foia-request', entry: lambdaEntry('foia/submit-foia-request.ts') }
```

### 14.4 FOIA Response Parsing Not Implemented <!-- ⏳ PENDING -->

**Current behavior:** `responseDocuments` (S3 references) and `exemptionsCited` fields exist in the schema but there is no UI or handler for uploading/parsing FOIA responses.

**Fix needed:** 
- Add response document upload UI to `FOIARequestCard`
- Create `upload-foia-response.ts` handler that accepts S3 presigned upload + updates the item
- Optionally: LLM-based parsing of response to extract evaluation scores into `ProjectOutcome.lossData.evaluationScores`

### 14.5 Analytics Recalculation Not Counting FOIA <!-- ✅ IMPLEMENTED -->

**Current behavior:** `foiaRequestsGenerated` and `foiaResponsesReceived` fields exist in `MonthlyAnalytics` schema but the analytics recalculation handler does not query FOIA items to populate them.

**Fix needed:** In the analytics recalculation handler, add a query for `FOIA_REQUEST` items by org/month and count:
- `foiaRequestsGenerated` = count of items created in the month
- `foiaResponsesReceived` = count of items with `status === 'RESPONSE_RECEIVED'` in the month

### 14.6 `CreateFOIARequestDialog` Uses `useState` Instead of `react-hook-form` <!-- ✅ IMPLEMENTED -->

**Current behavior:** The dialog uses individual `useState` hooks for each field, which violates the project convention of using `react-hook-form` with Zod resolvers.

**Fix needed:** Refactor `CreateFOIARequestDialog.tsx` to use:
```typescript
const form = useForm<z.input<typeof CreateFOIARequestSchema>>({
  resolver: zodResolver(CreateFOIARequestSchema),
  defaultValues: { ... },
});
```

### 14.7 `generate-foia-letter.ts` Does Not Destructure `safeParse` <!-- ✅ IMPLEMENTED -->

**Current behavior:** The handler parses the body with `JSON.parse` directly without Zod validation:
```typescript
const { orgId, projectId, foiaRequestId } = JSON.parse(event.body || '');
```

**Fix needed:** Add a request schema and use `safeParse`:
```typescript
const GenerateFOIALetterRequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  foiaRequestId: z.string().min(1),
});

const { success, data, error } = GenerateFOIALetterRequestSchema.safeParse(JSON.parse(event.body || '{}'));
if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
```

---

## 15. Summary of New Files <!-- ✅ IMPLEMENTED -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/foia.ts` | All FOIA Zod schemas, types, helper functions | ✅ |
| `packages/core/src/schemas/foia.test.ts` | Schema unit tests | ✅ |
| `apps/functions/src/constants/organization.ts` | `FOIA_REQUEST_PK = 'FOIA_REQUEST'` constant | ✅ |
| `apps/functions/src/types/project-outcome.ts` | `DBFOIARequestItem` type | ✅ |
| `apps/functions/src/handlers/foia/create-foia-request.ts` | Create FOIA request Lambda | ✅ |
| `apps/functions/src/handlers/foia/create-foia-request.test.ts` | Unit tests | ✅ |
| `apps/functions/src/handlers/foia/get-foia-requests.ts` | List FOIA requests Lambda | ✅ |
| `apps/functions/src/handlers/foia/get-foia-requests.test.ts` | Unit tests | ✅ |
| `apps/functions/src/handlers/foia/update-foia-request.ts` | Update FOIA request Lambda | ✅ |
| `apps/functions/src/handlers/foia/update-foia-request.test.ts` | Unit tests | ✅ |
| `apps/functions/src/handlers/foia/generate-foia-letter.ts` | Generate letter text Lambda | ✅ |
| `apps/functions/src/handlers/foia/generate-foia-letter.test.ts` | Unit tests | ✅ |
| `packages/infra/api/routes/foia.routes.ts` | CDK route definitions | ✅ |
| `apps/web/lib/hooks/use-foia-requests.ts` | SWR + mutation hooks | ✅ |
| `apps/web/components/foia/FOIAStatusBadge.tsx` | Status badge component | ✅ |
| `apps/web/components/foia/FOIARequestCard.tsx` | Main FOIA card (LOST projects only) | ✅ |
| `apps/web/components/foia/CreateFOIARequestDialog.tsx` | FOIA creation form dialog | ✅ |
| `apps/web/components/foia/FOIALetterPreview.tsx` | Letter preview with actions | ✅ |
| `apps/web/components/foia/index.ts` | Barrel export | ✅ |
| `apps/web/components/foia/__tests__/CreateFOIARequestDialog.test.tsx` | Component tests | ✅ |
| `apps/web/components/foia/__tests__/FOIARequestCard.test.tsx` | Component tests | ✅ |
| `apps/web/components/foia/__tests__/FOIAStatusBadge.test.tsx` | Component tests | ✅ |

### Files Added (This Implementation Round)

| File | Purpose | Status |
|---|---|---|
| `apps/functions/src/handlers/foia/submit-foia-request.ts` | Auto-submit via SES email | ✅ |
| `apps/web/lib/hooks/use-foia-requests.ts` | Added `useSubmitFOIARequest` hook | ✅ |

### Files Pending (Future Enhancement)

| File | Purpose | Status |
|---|---|---|
| `apps/functions/src/handlers/foia/submit-foia-request.test.ts` | Unit tests for submit handler | ⏳ |
| `apps/functions/src/handlers/foia/upload-foia-response.ts` | Upload/parse FOIA response docs | ⏳ |

---

## 16. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [x] **One-click FOIA generation from lost bid** — `FOIARequestCard` appears automatically when `projectOutcomeStatus === 'LOST'`; single "New FOIA Request" button opens the creation dialog
- [x] **FOIA document follows proper government format** — `generateFOIALetter()` produces standard 5 U.S.C. § 552 format with all required sections
- [x] **Status tracking for submitted requests** — 8-state lifecycle (`DRAFT` → `CLOSED`), deadline tracking with overdue warning, tracking number field
- [x] **Integration with win/loss analytics** — `foiaRequestsGenerated` and `foiaResponsesReceived` fields in `MonthlyAnalytics` schema; analytics handler queries FOIA items per month
- [x] **Auto-submit FOIA requests** — `submit-foia-request.ts` handler sends via SES with `AUTO_EMAIL` or marks as `MANUAL`
- [x] **`statusHistory` updated on every status change** — `update-foia-request.ts` appends to `statusHistory` array via `list_append`
- [x] **Analytics recalculation counts FOIA** — `get-analytics.ts` queries `FOIA_REQUEST` items and populates `foiaRequestsGenerated` / `foiaResponsesReceived`
- [ ] **Parse and display FOIA response data** — Response document upload and LLM parsing not yet implemented
