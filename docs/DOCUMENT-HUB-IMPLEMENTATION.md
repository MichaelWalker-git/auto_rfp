# AutoRFP Document Hub — Step-by-Step Technical Implementation Guide

> **Version**: 1.0  
> **Date**: February 2026  
> **Status**: Proposed  
> **Author**: Engineering Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [Phase 1 — Document Management Hub](#4-phase-1--document-management-hub)
5. [Phase 2 — Automatic Linear Sync](#5-phase-2--automatic-linear-sync)
6. [Phase 3 — Document Preview & Download](#6-phase-3--document-preview--download)
7. [Phase 4 — Google Drive Integration](#7-phase-4--google-drive-integration)
8. [Phase 5 — Signature Tracking & E-Signature](#8-phase-5--signature-tracking--e-signature)
9. [Technology Stack & Dependencies](#9-technology-stack--dependencies)
10. [Security Considerations](#10-security-considerations)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Appendix — Technology Evaluation](#12-appendix--technology-evaluation)

---

## 1. Executive Summary

This document provides a **step-by-step technical implementation guide** for extending AutoRFP with a centralized Document Hub. The feature set addresses the client's request to:

1. **Upload & manage RFP process documents** — A dedicated section where the team can upload and work on documents developed throughout the RFP lifecycle
2. **Auto-sync to Linear** — Every document upload or update is automatically reflected in Linear as comments on the Executive Opportunity Brief ticket
3. **Preview & download in-app** — Documents can be previewed and downloaded directly within AutoRFP, with maintained document links for faster reviews
4. **Signature tracking** — Track signature status of documents, with Google Drive integration for external signing workflows and optional DocuSign integration

### Current State (What Exists)

| Capability | Current Implementation |
|---|---|
| Executive Brief → Linear | `infrastructure/lambda/brief/handle-linear-ticket.ts` creates/updates Linear issues |
| Linear API Key Management | `infrastructure/lambda/linear/get-api-key.ts` + `save-api-key.ts` via SSM |
| S3 File Storage | `infrastructure/lib/storage-stack.ts` — `documentsBucket` with versioning, CORS, lifecycle rules |
| Presigned URLs | `infrastructure/lambda/presigned/generate-presigned-url.ts` for upload/download |
| DynamoDB Single Table | `infrastructure/lib/database-stack.ts` — partition_key/sort_key pattern |
| Knowledge Base Documents | `infrastructure/lambda/document/` — CRUD for KB documents (org-level) |
| Question Files (RFP uploads) | `infrastructure/lambda/question-file/` — per-project RFP solicitation files |
| SQS Async Processing | `infrastructure/lib/storage-stack.ts` — `execBriefQueue` for brief generation |
| Existing Documents Page | `web-app/app/organizations/[orgId]/projects/[projectId]/documents/page.tsx` |
| Existing RFP Documents Page | `web-app/app/organizations/[orgId]/projects/[projectId]/rfp-documents/page.tsx` |
| RFP Document Routes | `infrastructure/lib/api/routes/rfp-document.routes.ts` (exists, needs extension) |

### Target State

A fully integrated document lifecycle: **Upload → S3 → DynamoDB → SQS → Linear Comment → Preview/Download → Google Drive → Sign → Sync Back → Linear Update**

---

## 2. Requirements Analysis

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Upload documents (PDF, DOCX, XLSX, PNG, JPG, TXT) up to 100MB | P0 |
| FR-2 | List all documents for a project/opportunity with filtering by type | P0 |
| FR-3 | Preview documents in-app (PDF viewer, image viewer, text viewer) | P0 |
| FR-4 | Download documents with original filename | P0 |
| FR-5 | Auto-create Linear comment when document is uploaded | P0 |
| FR-6 | Auto-update Linear comment when document is updated/versioned | P0 |
| FR-7 | Version management — upload new versions, view version history | P1 |
| FR-8 | Track signature status (not required, pending, partially signed, fully signed, rejected) | P1 |
| FR-9 | Manage signers (name, email, role, status) | P1 |
| FR-10 | Upload documents to Google Drive for external sharing | P2 |
| FR-11 | Sync signed documents back from Google Drive | P2 |
| FR-12 | DocuSign integration for embedded e-signatures | P3 |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Linear sync must be asynchronous (SQS) — never block the upload response |
| NFR-2 | Presigned URLs must expire within 1 hour for preview, 15 minutes for upload |
| NFR-3 | All operations must respect RBAC permissions |
| NFR-4 | Soft-delete pattern (set `deletedAt`, never hard-delete) |
| NFR-5 | All file operations use presigned URLs — no file data passes through Lambda |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js 15)                              │
│                                                                              │
│  /organizations/[orgId]/projects/[projectId]/rfp-documents/                  │
│  ├── RFPDocumentsSection (main container)                                    │
│  │   ├── DocumentUploadDialog → POST /rfp-document/create                    │
│  │   ├── DocumentList → GET /rfp-document/list                               │
│  │   │   └── DocumentCard (per document)                                     │
│  │   │       ├── Preview → POST /rfp-document/preview-url → DocumentPreview  │
│  │   │       ├── Download → POST /rfp-document/download-url                  │
│  │   │       ├── Edit → PATCH /rfp-document/update                           │
│  │   │       ├── Delete → DELETE /rfp-document/delete                        │
│  │   │       ├── Signature → POST /rfp-document/update-signature             │
│  │   │       └── LinearSyncIndicator (sync status badge)                     │
│  │   └── DocumentPreviewDialog                                               │
│  │       ├── PDFViewer (react-pdf)                                           │
│  │       ├── ImageViewer (native <img>)                                      │
│  │       └── TextViewer (syntax highlighted)                                 │
│  └── SignatureTrackerPanel (signer management)                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (REST API)                                  │
│  Base path: /rfp-document                                                    │
│  ├── POST   /create           → create-rfp-document Lambda                   │
│  ├── GET    /list             → get-rfp-documents Lambda                     │
│  ├── GET    /get              → get-rfp-document Lambda                      │
│  ├── PATCH  /update           → update-rfp-document Lambda                   │
│  ├── DELETE /delete           → delete-rfp-document Lambda                   │
│  ├── POST   /preview-url     → get-document-preview-url Lambda              │
│  ├── POST   /download-url    → get-document-download-url Lambda             │
│  ├── POST   /update-signature → update-signature-status Lambda              │
│  ├── POST   /upload-to-drive  → upload-to-drive Lambda (Phase 4)            │
│  └── POST   /sync-from-drive  → sync-from-drive Lambda (Phase 4)            │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌──────────┐    ┌──────────┐    ┌──────────────────┐
            │ DynamoDB  │    │    S3    │    │   SQS Queue      │
            │ (RFP-     │    │ (auto-  │    │ (rfp-doc-linear  │
            │  table)   │    │  rfp-   │    │  -sync)          │
            │           │    │  docs)  │    └────────┬─────────┘
            │ PK: RFP_  │    │         │             │
            │ DOCUMENT  │    │ orgId/  │             ▼
            │ SK: proj# │    │ projId/ │    ┌──────────────────┐
            │ opp#docId │    │ oppId/  │    │ sync-document-   │
            └──────────┘    │ rfp-doc/│    │ to-linear Lambda │
                            │ docId/  │    └────────┬─────────┘
                            │ v1/file │             │
                            └─────────┘             ▼
                                            ┌──────────────────┐
                                            │   Linear API     │
                                            │ (create/update   │
                                            │  comment on      │
                                            │  Brief ticket)   │
                                            └──────────────────┘
```

### Data Flow — Document Upload

```
1. User selects file in DocumentUploadDialog
2. Frontend calls POST /rfp-document/create with metadata (name, type, mimeType, size)
3. Lambda validates input, creates DynamoDB record, generates presigned S3 PUT URL
4. Lambda enqueues SQS message for Linear sync (non-blocking)
5. Lambda returns { document, upload: { url, method } }
6. Frontend uploads file directly to S3 using presigned URL (XHR with progress)
7. SQS triggers sync-document-to-linear Lambda
8. Sync Lambda fetches document from DynamoDB, gets Linear ticket ID from Executive Brief
9. Sync Lambda creates/updates Linear comment with document info + presigned links
10. Sync Lambda updates DynamoDB with linearCommentId and syncStatus
```

### Data Flow — Document Preview

```
1. User clicks "Preview" on DocumentCard
2. Frontend calls POST /rfp-document/preview-url with documentId
3. Lambda generates presigned S3 GET URL (Content-Disposition: inline, 1hr expiry)
4. Frontend opens DocumentPreviewDialog
5. Based on mimeType:
   - PDF → react-pdf Document/Page components with presigned URL
   - Image → <img src={presignedUrl} />
   - Text → fetch content, render with syntax highlighting
   - Other → "Preview not available" + download button
```

### Data Flow — Signature Tracking

```
1. User clicks "Manage Signatures" on DocumentCard
2. SignatureTrackerPanel opens with current signers list
3. User adds signers (name, email, role) and sets status to PENDING_SIGNATURE
4. Frontend calls POST /rfp-document/update-signature
5. Lambda validates status transition, updates DynamoDB
6. Lambda enqueues SQS message for Linear sync
7. Linear comment is updated with signature status and signer details
8. (Phase 4) User clicks "Upload to Drive" → document uploaded to Google Drive
9. (Phase 4) External signers sign on Drive
10. (Phase 4) User clicks "Sync from Drive" → signed version downloaded, new version created
11. Status automatically updated to FULLY_SIGNED, Linear comment updated
```

---

## 4. Phase 1 — Document Management Hub

### Step 1.1: Create Shared Schema

**File:** `shared/src/schemas/rfp-document.ts`

This defines all TypeScript types and Zod validation schemas used by both backend and frontend. Key types:

- `RFPDocumentType` — enum of document categories (EXECUTIVE_BRIEF, TECHNICAL_PROPOSAL, COST_PROPOSAL, etc.)
- `SignatureStatus` — enum (NOT_REQUIRED, PENDING_SIGNATURE, PARTIALLY_SIGNED, FULLY_SIGNED, REJECTED)
- `LinearSyncStatus` — enum (NOT_SYNCED, SYNCED, SYNC_FAILED)
- `RFPDocumentItemSchema` — full DynamoDB record schema
- `CreateRFPDocumentDTOSchema` — input validation for create endpoint
- `UpdateRFPDocumentDTOSchema` — input validation for update endpoint
- `UpdateSignatureStatusDTOSchema` — input validation for signature updates
- `LinearDocSyncMessageSchema` — SQS message payload schema

> **Full schema definition:** See `docs/DOCUMENT-MANAGEMENT-FEATURE.md` § Part 1.2

**Export from shared index:**

```typescript
// shared/src/index.ts — add:
export * from './schemas/rfp-document';
```

### Step 1.2: Create DynamoDB Constant

**File:** `infrastructure/constants/rfp-document.js`

```javascript
module.exports.RFP_DOCUMENT_PK = 'RFP_DOCUMENT';
```

Follows the pattern of `infrastructure/constants/document.js`, `infrastructure/constants/question-file.js`, etc.

### Step 1.3: Create Helper Functions

**File:** `infrastructure/lambda/helpers/rfp-document.ts`

Core database operations following the exact patterns in `infrastructure/lambda/helpers/document.ts`:

| Function | Purpose |
|---|---|
| `buildRFPDocumentSK(projectId, oppId, docId)` | Build sort key: `${projectId}#${oppId}#${docId}` |
| `buildRFPDocumentS3Key(args)` | Build S3 key: `${orgId}/${projectId}/${oppId}/rfp-documents/${docId}/v${version}/${fileName}` |
| `putRFPDocument(item)` | DynamoDB PutCommand |
| `getRFPDocument(projectId, oppId, docId)` | DynamoDB GetCommand with ConsistentRead |
| `listRFPDocumentsByOpportunity(args)` | DynamoDB QueryCommand with pagination, soft-delete filter |
| `updateRFPDocumentMetadata(args)` | DynamoDB UpdateCommand for name/description/type |
| `softDeleteRFPDocument(args)` | Set `deletedAt` timestamp |
| `updateRFPDocumentSignatureStatus(args)` | Update signature fields |
| `updateRFPDocumentLinearSync(args)` | Update Linear sync fields |
| `updateRFPDocumentVersion(args)` | Increment version, update fileKey |

> **Full implementation:** See `docs/DOCUMENT-MANAGEMENT-FEATURE.md` § Part 2.1

### Step 1.4: Create CRUD Lambda Functions

All Lambdas follow the established pattern:
- `middy` middleware chain with `authContextMiddleware`, `orgMembershipMiddleware`, `requirePermission`, `httpErrorMiddleware`
- `withSentryLambda` wrapper for error tracking
- Zod validation on request body
- `apiResponse` helper for consistent HTTP responses

| Lambda File | HTTP Method | Path | Permission |
|---|---|---|---|
| `create-rfp-document.ts` | POST | `/rfp-document/create` | `document:create` |
| `get-rfp-documents.ts` | GET | `/rfp-document/list` | `document:read` |
| `get-rfp-document.ts` | GET | `/rfp-document/get` | `document:read` |
| `update-rfp-document.ts` | PATCH | `/rfp-document/update` | `document:update` |
| `delete-rfp-document.ts` | DELETE | `/rfp-document/delete` | `document:delete` |
| `get-document-preview-url.ts` | POST | `/rfp-document/preview-url` | `document:read` |
| `get-document-download-url.ts` | POST | `/rfp-document/download-url` | `document:read` |
| `update-signature-status.ts` | POST | `/rfp-document/update-signature` | `document:update` |

**Create Lambda key behavior:**
1. Validates input with `CreateRFPDocumentDTOSchema`
2. Validates mime type against allowlist (PDF, DOCX, XLSX, PNG, JPG, TXT)
3. Validates file size (max 100MB)
4. Generates UUID for `documentId`
5. Builds S3 key and generates presigned PUT URL (15-min expiry)
6. Creates DynamoDB record with initial state
7. Enqueues SQS message for Linear sync
8. Returns `{ document, upload: { url, method, expiresIn } }`

**Preview URL Lambda key behavior:**
1. Fetches document from DynamoDB
2. Validates org ownership
3. Generates presigned GET URL with `Content-Disposition: inline` (1-hour expiry)
4. Returns `{ url, mimeType, fileName, expiresIn }`

**Download URL Lambda key behavior:**
- Same as preview but with `Content-Disposition: attachment; filename="${name}"`

> **Full Lambda implementations:** See `docs/DOCUMENT-MANAGEMENT-FEATURE.md` § Part 2.4

### Step 1.5: Create API Routes

**File:** `infrastructure/lib/api/routes/rfp-document.routes.ts`

Following the pattern of `infrastructure/lib/api/routes/projects.routes.ts`:

```typescript
import type { DomainRoutes } from './types';

export function rfpDocumentDomain(args: {
  rfpDocSyncQueueUrl: string;
}): DomainRoutes {
  return {
    basePath: 'rfp-document',
    routes: [
      {
        method: 'POST',
        path: 'create',
        entry: 'lambda/rfp-document/create-rfp-document.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: args.rfpDocSyncQueueUrl },
      },
      { method: 'GET', path: 'list', entry: 'lambda/rfp-document/get-rfp-documents.ts' },
      { method: 'GET', path: 'get', entry: 'lambda/rfp-document/get-rfp-document.ts' },
      {
        method: 'PATCH',
        path: 'update',
        entry: 'lambda/rfp-document/update-rfp-document.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: args.rfpDocSyncQueueUrl },
      },
      {
        method: 'DELETE',
        path: 'delete',
        entry: 'lambda/rfp-document/delete-rfp-document.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: args.rfpDocSyncQueueUrl },
      },
      { method: 'POST', path: 'preview-url', entry: 'lambda/rfp-document/get-document-preview-url.ts' },
      { method: 'POST', path: 'download-url', entry: 'lambda/rfp-document/get-document-download-url.ts' },
      {
        method: 'POST',
        path: 'update-signature',
        entry: 'lambda/rfp-document/update-signature-status.ts',
        extraEnv: { RFP_DOC_SYNC_QUEUE_URL: args.rfpDocSyncQueueUrl },
      },
    ],
  };
}
```

### Step 1.6: Register Routes in CDK Orchestrator

**File:** `infrastructure/lib/api/api-orchestrator-stack.ts`

Add the `rfpDocumentDomain` to the orchestrator stack alongside existing domain stacks. This involves:

1. Importing `rfpDocumentDomain` from routes
2. Creating the SQS queue (see Phase 2)
3. Creating a new `ApiDomainRoutesStack` for the rfp-document routes

### Step 1.7: Create Frontend Hooks

**File:** `web-app/lib/hooks/use-rfp-documents.ts`

SWR-based hooks following the pattern of `web-app/lib/hooks/use-knowledgebase.ts`:

| Hook | Purpose |
|---|---|
| `useRFPDocuments(projectId, oppId, orgId)` | List documents with SWR caching |
| `useCreateRFPDocument(orgId)` | `useSWRMutation` for POST create |
| `useUpdateRFPDocument(orgId)` | `useSWRMutation` for PATCH update |
| `useDeleteRFPDocument(orgId)` | `useSWRMutation` for DELETE |
| `useDocumentPreviewUrl(orgId)` | `useSWRMutation` for preview URL |
| `useDocumentDownloadUrl(orgId)` | `useSWRMutation` for download URL |
| `useUpdateSignatureStatus(orgId)` | `useSWRMutation` for signature updates |
| `uploadFileToPresignedUrl(url, file, onProgress)` | XHR upload with progress callback |

### Step 1.8: Create Frontend Components

**Directory:** `web-app/components/rfp-documents/`

| Component | Description | Shadcn UI Components Used |
|---|---|---|
| `RFPDocumentsSection.tsx` | Main container — header, upload button, document list | `Card`, `Button` |
| `DocumentList.tsx` | Grid/list of DocumentCards with filtering/sorting | `Select`, `Input` |
| `DocumentCard.tsx` | Single document with actions (preview, download, edit, delete) | `Card`, `Badge`, `DropdownMenu`, `Button` |
| `DocumentUploadDialog.tsx` | Modal with drag-drop zone, metadata form, progress bar | `Dialog`, `Input`, `Select`, `Textarea`, `Progress` |
| `DocumentPreviewDialog.tsx` | Full-screen modal with PDF/image/text viewer | `Dialog`, `Button` |
| `SignatureStatusBadge.tsx` | Color-coded badge for signature status | `Badge` |
| `SignatureTrackerPanel.tsx` | Signer list management panel | `Card`, `Input`, `Button`, `Select` |
| `LinearSyncIndicator.tsx` | Small icon showing Linear sync status | `Tooltip`, custom icon |

### Step 1.9: Wire Up the Page

**File:** `web-app/app/organizations/[orgId]/projects/[projectId]/rfp-documents/page.tsx`

This page already exists. Update it to render the `RFPDocumentsSection` component with the correct props from URL params.

---

## 5. Phase 2 — Automatic Linear Sync

### Step 2.1: Create SQS Queue

**File:** `infrastructure/lib/storage-stack.ts` — add alongside `execBriefQueue`:

```typescript
// RFP Document → Linear sync queue
this.rfpDocSyncQueue = new sqs.Queue(this, 'RfpDocSyncQueue', {
  queueName: `auto-rfp-doc-linear-sync-${stage}`,
  visibilityTimeout: cdk.Duration.seconds(60),
  retentionPeriod: cdk.Duration.days(7),
  encryption: sqs.QueueEncryption.SQS_MANAGED,
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'RfpDocSyncDLQ', {
      queueName: `auto-rfp-doc-linear-sync-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    }),
    maxReceiveCount: 3,
  },
});
```

**Why not FIFO?** The existing `execBriefQueue` is a standard queue. For consistency and because strict ordering isn't critical (each document sync is independent), we use a standard queue. If ordering per-document becomes important, switch to FIFO with `MessageGroupId = documentId`.

### Step 2.2: Create Sync Queue Helper

**File:** `infrastructure/lambda/helpers/rfp-document-sync-queue.ts`

```typescript
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';

const sqs = new SQSClient({});
const QUEUE_URL = requireEnv('RFP_DOC_SYNC_QUEUE_URL');

export async function enqueueLinearDocSync(message: {
  documentId: string;
  projectId: string;
  opportunityId: string;
  orgId: string;
  action: 'CREATE' | 'UPDATE' | 'VERSION' | 'SIGNATURE_UPDATE' | 'DELETE';
}): Promise<void> {
  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }));
  } catch (err) {
    // Log but don't fail the main operation
    console.error('Failed to enqueue Linear doc sync (non-fatal):', err);
  }
}
```

### Step 2.3: Extend Linear Client

The existing Linear integration uses the `@linear/sdk` package. We need to add comment operations.

**Approach:** Add helper functions that use the Linear SDK's `createComment` and `updateComment` methods.

```typescript
// Using @linear/sdk (already installed)
import { LinearClient } from '@linear/sdk';

// Create comment on an issue
const commentPayload = await linearClient.createComment({
  issueId: 'issue-id-here',
  body: '## 📄 Document: Technical Proposal\n\n**Type:** TECHNICAL_PROPOSAL\n**Version:** v1\n...',
});
const comment = await commentPayload.comment;
// comment.id → store in DynamoDB as linearCommentId

// Update existing comment
await linearClient.updateComment('comment-id-here', {
  body: 'Updated comment text with new version info',
});
```

**Linear Comment Format (Markdown):**

```markdown
## 📄 Document: Technical Proposal

**Type:** TECHNICAL_PROPOSAL
**Version:** v2
**Signature:** ⏳ PENDING_SIGNATURE

**Signers:**
- ⏳ John Smith (Program Manager) — PENDING
- ✅ Jane Doe (Contracts Officer) — SIGNED

**Updated:** 2026-02-11T14:30:00Z

Technical proposal for the XYZ program...

📎 [Preview Document](https://presigned-url) | [Download](https://presigned-url)

---
*Auto-synced from AutoRFP*
```

### Step 2.4: Create Sync Worker Lambda

**File:** `infrastructure/lambda/rfp-document/sync-document-to-linear.ts`

This is an **SQS-triggered Lambda** (not API Gateway), following the pattern of `infrastructure/lambda/brief/exec-brief-worker.ts`:

**Key behavior:**
1. Receives SQS event with `LinearDocSyncMessage` payload
2. Fetches document from DynamoDB
3. Fetches Executive Brief to get `linearTicketId`
4. If no Linear ticket exists → log warning, mark as SYNC_FAILED, skip
5. Generates presigned preview/download URLs (7-day expiry for Linear comments)
6. Builds markdown comment body with document metadata
7. If `action === 'CREATE'` → `linearClient.createComment()` → store `linearCommentId`
8. If `action === 'UPDATE' | 'VERSION' | 'SIGNATURE_UPDATE'` → `linearClient.updateComment()` using stored `linearCommentId`
9. If `action === 'DELETE'` → update comment to show "Document deleted"
10. Updates DynamoDB with `linearSyncStatus: 'SYNCED'` and `lastSyncedAt`
11. On error → updates `linearSyncStatus: 'SYNC_FAILED'`, re-throws for SQS retry

**CDK wiring:**

```typescript
// In api-orchestrator-stack.ts
const rfpDocSyncWorker = new lambdaNodejs.NodejsFunction(this, 'RfpDocSyncWorker', {
  entry: 'lambda/rfp-document/sync-document-to-linear.ts',
  handler: 'handler',
  timeout: cdk.Duration.seconds(60),
  memorySize: 512,
  environment: { ...commonEnv },
});

rfpDocSyncWorker.addEventSource(
  new lambdaEventSources.SqsEventSource(rfpDocSyncQueue, {
    batchSize: 1,
    reportBatchItemFailures: true,
  }),
);
```

### Step 2.5: Integrate Sync Triggers

Add `enqueueLinearDocSync()` calls to every CRUD Lambda:

| Lambda | Trigger Point | Action |
|---|---|---|
| `create-rfp-document.ts` | After DynamoDB put | `CREATE` |
| `update-rfp-document.ts` | After DynamoDB update | `UPDATE` |
| `delete-rfp-document.ts` | After soft delete | `DELETE` |
| `update-signature-status.ts` | After signature update | `SIGNATURE_UPDATE` |
| `create-document-version.ts` | After version upload | `VERSION` |

---

## 6. Phase 3 — Document Preview & Download

### Step 3.1: Technology Selection

| File Type | Preview Technology | Rationale |
|---|---|---|
| **PDF** | `react-pdf` (wojtekmaj/react-pdf) | Most mature React PDF viewer, uses PDF.js, supports page navigation, zoom, text selection. 171 code snippets, benchmark score 76.3. |
| **Images** (PNG, JPG, GIF) | Native `<img>` tag | No library needed, works with presigned URLs directly |
| **Text** (TXT, MD) | `<pre>` with syntax highlighting | Fetch content via presigned URL, render as text |
| **DOCX** | Server-side conversion to PDF | Option A: Lambda with LibreOffice layer converts DOCX→PDF, then use react-pdf. Option B: Use `mammoth.js` for client-side DOCX→HTML (lighter but less accurate). **Recommended: Option B for MVP, Option A for production.** |
| **XLSX** | Download only (MVP) | Full spreadsheet preview is complex; defer to download |

### Step 3.2: Install react-pdf

```bash
cd web-app && pnpm add react-pdf
```

### Step 3.3: Configure PDF.js Worker

```typescript
// web-app/lib/pdf-worker.ts
import { pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
```

### Step 3.4: Create PDFViewer Component

**File:** `web-app/components/rfp-documents/PDFViewer.tsx`

```tsx
'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PDFViewerProps {
  url: string;
}

export function PDFViewer({ url }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

  return (
    <div className="flex flex-col items-center gap-4">
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div>Loading PDF...</div>}
        error={<div>Failed to load PDF</div>}
      >
        <Page pageNumber={pageNumber} width={800} />
      </Document>
      <div className="flex items-center gap-4">
        <button disabled={pageNumber <= 1} onClick={() => setPageNumber(p => p - 1)}>
          Previous
        </button>
        <span>Page {pageNumber} of {numPages}</span>
        <button disabled={pageNumber >= numPages} onClick={() => setPageNumber(p => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
```

### Step 3.5: Create DocumentPreviewDialog Component

**File:** `web-app/components/rfp-documents/DocumentPreviewDialog.tsx`

This component detects the file type and renders the appropriate viewer:

```tsx
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PDFViewer } from './PDFViewer';
import { Download, X } from 'lucide-react';

interface DocumentPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  url: string | null;
  mimeType: string;
  fileName: string;
  downloadUrl?: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);

export function DocumentPreviewDialog({
  isOpen, onClose, url, mimeType, fileName, downloadUrl,
}: DocumentPreviewDialogProps) {
  if (!url) return null;

  const renderViewer = () => {
    if (mimeType === 'application/pdf') {
      return <PDFViewer url={url} />;
    }
    if (IMAGE_TYPES.has(mimeType)) {
      return <img src={url} alt={fileName} className="max-w-full max-h-[80vh] object-contain" />;
    }
    if (TEXT_TYPES.has(mimeType)) {
      return <TextViewer url={url} />;
    }
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Preview not available for this file type.</p>
        {downloadUrl && (
          <Button asChild className="mt-4">
            <a href={downloadUrl} download={fileName}>
              <Download className="mr-2 h-4 w-4" /> Download
            </a>
          </Button>
        )}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            {fileName}
            <div className="flex gap-2">
              {downloadUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={downloadUrl} download={fileName}>
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>
        {renderViewer()}
      </DialogContent>
    </Dialog>
  );
}
```

### Step 3.6: Presigned URL Strategy

| Use Case | Content-Disposition | Expiry | Generated By |
|---|---|---|---|
| Upload | N/A (PUT) | 15 minutes | `create-rfp-document` Lambda |
| Preview | `inline` | 1 hour | `get-document-preview-url` Lambda |
| Download | `attachment; filename="..."` | 1 hour | `get-document-download-url` Lambda |
| Linear Comment Links | `inline` | 7 days | `sync-document-to-linear` Lambda |

---

## 7. Phase 4 — Google Drive Integration

### Step 4.1: Prerequisites

1. **Google Cloud Project** with Drive API enabled
2. **Service Account** with Drive API access (or OAuth 2.0 for per-user access)
3. **Credentials** stored in AWS Secrets Manager
4. **Shared Drive folder** (optional) for organization-level access

### Step 4.2: Install googleapis

```bash
cd infrastructure && npm install googleapis
```

### Step 4.3: Google Drive Helper

**File:** `infrastructure/lambda/helpers/google-drive.ts`

```typescript
import { google } from 'googleapis';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSecret } from './secrets'; // existing helper for Secrets Manager

const s3 = new S3Client({});

async function getDriveClient() {
  const credentials = JSON.parse(await getSecret('google-drive-service-account'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client as any });
}

export async function uploadToDrive(args: {
  s3Bucket: string;
  s3Key: string;
  fileName: string;
  mimeType: string;
  driveFolderId?: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const drive = await getDriveClient();

  // Stream file from S3
  const s3Response = await s3.send(new GetObjectCommand({
    Bucket: args.s3Bucket,
    Key: args.s3Key,
  }));

  const res = await drive.files.create({
    requestBody: {
      name: args.fileName,
      mimeType: args.mimeType,
      parents: args.driveFolderId ? [args.driveFolderId] : undefined,
    },
    media: {
      mimeType: args.mimeType,
      body: s3Response.Body as any,
    },
    fields: 'id,webViewLink',
  });

  return {
    fileId: res.data.id!,
    webViewLink: res.data.webViewLink!,
  };
}

export async function downloadFromDrive(args: {
  fileId: string;
}): Promise<{ data: Buffer; mimeType: string; modifiedTime: string }> {
  const drive = await getDriveClient();

  // Get file metadata
  const meta = await drive.files.get({
    fileId: args.fileId,
    fields: 'mimeType,modifiedTime',
  });

  // Download file content
  const res = await drive.files.get(
    { fileId: args.fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );

  return {
    data: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType!,
    modifiedTime: meta.data.modifiedTime!,
  };
}
```

### Step 4.4: Upload to Drive Lambda

**File:** `infrastructure/lambda/rfp-document/upload-to-drive.ts`

**Key behavior:**
1. Fetches document from DynamoDB
2. Calls `uploadToDrive()` with S3 bucket/key
3. Updates document's `signatureDetails.driveFileId` and `driveFileUrl`
4. Sets `signatureStatus` to `PENDING_SIGNATURE` if not already
5. Enqueues Linear sync
6. Returns Drive file URL

### Step 4.5: Sync from Drive Lambda

**File:** `infrastructure/lambda/rfp-document/sync-from-drive.ts`

**Key behavior:**
1. Fetches document from DynamoDB, gets `driveFileId`
2. Calls `downloadFromDrive()` to get latest version
3. Compares `modifiedTime` with `lastSyncedAt`
4. If changed: uploads new version to S3, creates new document version
5. Updates signature status if file was modified (implies signing activity)
6. Enqueues Linear sync
7. Returns updated document

### Step 4.6: Drive Folder Structure

```
Google Drive/
└── AutoRFP/
    └── {Organization Name}/
        └── {Project Name}/
            ├── RFP Documents/
            ├── Working Documents/
            └── Signatures/
```

### Step 4.7: Frontend Integration

Add two buttons to `DocumentCard`:
- **"Upload to Drive"** — calls `POST /rfp-document/upload-to-drive`
- **"Sync from Drive"** — calls `POST /rfp-document/sync-from-drive`

Both show loading state and toast notifications on success/failure.

---

## 8. Phase 5 — Signature Tracking & E-Signature

### Step 5.1: Tier 1 — Manual Signature Tracking (MVP)

This is already covered in Phase 1 (Step 1.4, `update-signature-status.ts`). Key features:

**Signature Status State Machine:**

```
NOT_REQUIRED ──→ PENDING_SIGNATURE
                      │
              ┌───────┼───────┐
              ▼       ▼       ▼
      PARTIALLY_SIGNED  REJECTED  FULLY_SIGNED
              │       │       │
              └───┬───┘       │
                  ▼           │
          PENDING_SIGNATURE ←─┘ (re-open)
```

**Valid Transitions:**

| From | Allowed To |
|---|---|
| `NOT_REQUIRED` | `PENDING_SIGNATURE` |
| `PENDING_SIGNATURE` | `PARTIALLY_SIGNED`, `FULLY_SIGNED`, `REJECTED`, `NOT_REQUIRED` |
| `PARTIALLY_SIGNED` | `FULLY_SIGNED`, `REJECTED`, `PENDING_SIGNATURE` |
| `FULLY_SIGNED` | `PENDING_SIGNATURE` (re-open) |
| `REJECTED` | `PENDING_SIGNATURE`, `NOT_REQUIRED` |

**Signer Management:**
- Each signer has: `id`, `name`, `email`, `role`, `status` (PENDING/SIGNED/REJECTED), `signedAt`, `notes`
- Signers are stored in `signatureDetails.signers[]` array
- When all signers have `status: 'SIGNED'` → auto-set document to `FULLY_SIGNED`
- When any signer has `status: 'REJECTED'` → auto-set document to `REJECTED`

### Step 5.2: Tier 2 — DocuSign Integration (Future)

**Technology:** DocuSign eSignature REST API (`@docusign/esign-node-client`)

DocuSign was selected based on:
- Most widely used e-signature platform (400+ API endpoints)
- Node.js SDK available (`docusign-esign-node-client`)
- Supports embedded signing (in-app iframe)
- Webhook notifications (DocuSign Connect) for real-time status updates
- SOC 2 Type II compliant
- Winner of 2021 Best Business Software API (API World)

**Alternative considered:** Documenso (open-source, self-hosted) — good for cost savings but less mature API.

**DocuSign Integration Flow:**

```
1. User clicks "Send for Signature" on document
2. Lambda downloads document from S3
3. Lambda creates DocuSign envelope with signers
4. DocuSign sends email to signers
5. Signers sign via DocuSign
6. DocuSign Connect webhook fires → API Gateway → Lambda
7. Lambda downloads signed document from DocuSign
8. Lambda uploads signed document to S3 as new version
9. Lambda updates DynamoDB (status: FULLY_SIGNED)
10. Lambda enqueues Linear sync
11. Linear comment updated with ✅ FULLY_SIGNED status
```

**New Lambda Functions:**

| Lambda | Purpose |
|---|---|
| `docusign-send.ts` | Create envelope, send for signature |
| `docusign-webhook.ts` | Receive DocuSign Connect events |
| `docusign-status.ts` | Poll envelope status (fallback) |

**DocuSign Credentials:**
- Store in AWS Secrets Manager: `docusign-integration-key`, `docusign-secret-key`, `docusign-account-id`
- Use JWT Grant authentication (server-to-server, no user interaction needed)

### Step 5.3: Signature Status in Linear Comments

When signature status changes, the Linear comment is updated with visual indicators:

| Status | Emoji | Example |
|---|---|---|
| `NOT_REQUIRED` | — | (no signature section shown) |
| `PENDING_SIGNATURE` | ⏳ | **Signature:** ⏳ Pending |
| `PARTIALLY_SIGNED` | ✍️ | **Signature:** ✍️ 1 of 3 signed |
| `FULLY_SIGNED` | ✅ | **Signature:** ✅ Fully Signed |
| `REJECTED` | ❌ | **Signature:** ❌ Rejected |

---

## 9. Technology Stack & Dependencies

### Backend (New Dependencies)

| Package | Version | Purpose | Phase |
|---|---|---|---|
| `@linear/sdk` | existing | Linear API client (comments, attachments) | 2 |
| `googleapis` | ^130.0.0 | Google Drive API v3 | 4 |
| `docusign-esign` | ^7.0.0 | DocuSign eSignature API | 5 (Tier 2) |

### Frontend (New Dependencies)

| Package | Version | Purpose | Phase |
|---|---|---|---|
| `react-pdf` | ^10.1.0 | PDF document preview (uses PDF.js) | 3 |
| `pdfjs-dist` | ^4.x | PDF.js worker (peer dep of react-pdf) | 3 |
| `mammoth` | ^1.8.0 | DOCX → HTML conversion (optional, MVP) | 3 |

### Infrastructure (New Resources)

| Resource | Type | Purpose | Phase |
|---|---|---|---|
| SQS Queue | `auto-rfp-doc-linear-sync-{stage}` | Async Linear sync | 2 |
| SQS DLQ | `auto-rfp-doc-linear-sync-dlq-{stage}` | Failed sync messages | 2 |
| Lambda | `sync-document-to-linear` | SQS worker for Linear sync | 2 |
| Lambda (×8) | CRUD + preview/download/signature | API handlers | 1 |
| Secrets Manager | `google-drive-service-account` | Google Drive credentials | 4 |
| Secrets Manager | `docusign-*` | DocuSign credentials | 5 |

---

## 10. Security Considerations

| Concern | Mitigation |
|---|---|
| **File uploads** | Presigned URLs with 15-min expiry; file type + size validation server-side |
| **File access** | Presigned URLs with 1-hour expiry; org ownership verified before URL generation |
| **RBAC** | All endpoints use `authContextMiddleware` + `orgMembershipMiddleware` + `requirePermission` |
| **Soft delete** | Documents are never hard-deleted; `deletedAt` timestamp set |
| **S3 bucket** | `BlockPublicAccess.BLOCK_ALL`; versioning enabled; lifecycle rules for IA transition |
| **Linear API keys** | Stored in SSM Parameter Store (encrypted); retrieved per-request |
| **Google Drive credentials** | Stored in AWS Secrets Manager; service account with minimal scopes |
| **DocuSign credentials** | Stored in AWS Secrets Manager; JWT Grant auth (no user tokens) |
| **SQS messages** | SQS_MANAGED encryption; DLQ for failed messages |
| **Input validation** | Zod schemas on all request bodies; mime type allowlist |

---

## 11. Implementation Roadmap

### Sprint 1 (Weeks 1-2): Backend Foundation — 21 points

| Task | Points | Deliverable |
|---|---|---|
| Shared schema + constants | 5 | `shared/src/schemas/rfp-document.ts`, `infrastructure/constants/rfp-document.js` |
| Create Lambda + presigned upload | 8 | `create-rfp-document.ts` with S3 presigned URL |
| List + Get Lambdas | 5 | `get-rfp-documents.ts`, `get-rfp-document.ts` |
| API Gateway routes | 3 | `rfp-document.routes.ts` registered in CDK |

### Sprint 2 (Weeks 3-4): Backend Completion + Linear Queue — 19 points

| Task | Points | Deliverable |
|---|---|---|
| Update + Delete Lambdas | 5 | `update-rfp-document.ts`, `delete-rfp-document.ts` |
| Preview + Download URL Lambdas | 5 | `get-document-preview-url.ts`, `get-document-download-url.ts` |
| Version management Lambdas | 6 | `create-document-version.ts`, `get-document-versions.ts` |
| SQS queue infrastructure | 3 | Queue + DLQ in CDK |

### Sprint 3 (Weeks 5-6): Linear Integration + Frontend Hooks — 23 points

| Task | Points | Deliverable |
|---|---|---|
| Linear sync worker Lambda | 8 | `sync-document-to-linear.ts` (SQS-triggered) |
| Linear client extension | 5 | `createLinearComment`, `updateLinearComment` helpers |
| Sync trigger integration | 5 | `enqueueLinearDocSync()` in all CRUD Lambdas |
| Frontend hooks | 5 | `use-rfp-documents.ts` with all SWR hooks |

### Sprint 4 (Weeks 7-8): Frontend Components — 21 points

| Task | Points | Deliverable |
|---|---|---|
| Document list + card components | 5 | `DocumentList.tsx`, `DocumentCard.tsx` |
| Document upload dialog | 5 | `DocumentUploadDialog.tsx` with drag-drop + progress |
| Document preview dialog | 8 | `DocumentPreviewDialog.tsx` with PDF/image/text viewers |
| Main section + page wiring | 3 | `RFPDocumentsSection.tsx`, page.tsx update |

### Sprint 5 (Weeks 9-10): Signature Tracking + Polish — 23 points

| Task | Points | Deliverable |
|---|---|---|
| Signature status Lambda | 5 | `update-signature-status.ts` with state machine |
| Signature tracking UI | 5 | `SignatureStatusBadge.tsx`, `SignatureTrackerPanel.tsx` |
| CDK stack updates | 5 | All Lambdas, queues, permissions in CDK |
| Integration tests | 5 | E2E tests for upload, preview, sync flows |
| Documentation | 3 | User guide, API docs, architecture diagram |

### Future Sprint (Optional): Google Drive + DocuSign — 16 points

| Task | Points | Deliverable |
|---|---|---|
| Google Drive integration | 8 | `upload-to-drive.ts`, `sync-from-drive.ts` |
| DocuSign integration | 8 | `docusign-send.ts`, `docusign-webhook.ts` |

**Total: 107-123 story points across 5 sprints (10 weeks) + 1 optional sprint**

---

## 12. Appendix — Technology Evaluation

### A. PDF Preview Libraries Compared

| Library | Benchmark Score | Snippets | Approach | Verdict |
|---|---|---|---|---|
| `react-pdf` (wojtekmaj) | 76.3 | 171 | PDF.js wrapper for viewing existing PDFs | ✅ **Selected** — best for viewing |
| `@react-pdf/renderer` (diegomura) | 92.2 | 34 | React renderer for creating PDFs | ❌ Wrong use case (creation, not viewing) |
| `react-pdf-viewer` | 79.0 | 118 | Full-featured viewer with plugins | ⚠️ Good alternative, more features but heavier |

### B. E-Signature Platforms Compared

| Platform | Type | Node.js SDK | Pricing | Verdict |
|---|---|---|---|---|
| **DocuSign** | SaaS | `docusign-esign` | Per-envelope ($) | ✅ **Selected** — most mature, 400+ endpoints |
| **Documenso** | Open Source | REST API | Free (self-hosted) | ⚠️ Good alternative for cost savings |
| **HelloSign** (Dropbox) | SaaS | `hellosign-sdk` | Per-envelope ($) | ❌ Less mature API |
| **PandaDoc** | SaaS | REST API | Per-document ($) | ❌ More document-focused than signature-focused |
| **Adobe Sign** | SaaS | REST API | Enterprise ($$$) | ❌ Expensive, enterprise-only |

### C. Google Drive API Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth method | Service Account | Server-to-server, no user OAuth flow needed |
| API version | Drive API v3 | Latest stable version |
| Scopes | `drive.file` | Minimal scope — only access files created by the app |
| Storage | AWS Secrets Manager | Consistent with existing credential storage pattern |

### D. Linear API Capabilities Used

| Capability | API Method | SDK Method |
|---|---|---|
| Create comment | `commentCreate` mutation | `linearClient.createComment()` |
| Update comment | `commentUpdate` mutation | `linearClient.updateComment()` |
| Delete comment | `commentDelete` mutation | `linearClient.deleteComment()` |
| Upload file | `fileUpload` mutation | `linearClient.fileUpload()` |
| Create attachment | `attachmentCreate` mutation | `linearClient.createAttachment()` |

### E. File Type Support Matrix

| MIME Type | Extension | Upload | Preview | Download | Max Size |
|---|---|---|---|---|---|
| `application/pdf` | .pdf | ✅ | ✅ react-pdf | ✅ | 100MB |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | .docx | ✅ | ⚠️ mammoth.js (MVP) | ✅ | 100MB |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | .xlsx | ✅ | ❌ Download only | ✅ | 100MB |
| `image/png` | .png | ✅ | ✅ native `<img>` | ✅ | 100MB |
| `image/jpeg` | .jpeg/.jpg | ✅ | ✅ native `<img>` | ✅ | 100MB |
| `image/gif` | .gif | ✅ | ✅ native `<img>` | ✅ | 100MB |
| `text/plain` | .txt | ✅ | ✅ `<pre>` | ✅ | 100MB |
| `text/markdown` | .md | ✅ | ✅ `<pre>` | ✅ | 100MB |

---

## Cross-References

- **Detailed Schema & Lambda Code:** `docs/DOCUMENT-MANAGEMENT-FEATURE.md`
- **Implementation Tickets (Jira/Linear):** `docs/IMPLEMENTATION-TICKETS.md`
- **Existing Brief → Linear Flow:** `infrastructure/lambda/brief/handle-linear-ticket.ts`
- **Existing Presigned URL Pattern:** `infrastructure/lambda/presigned/generate-presigned-url.ts`
- **Existing SQS Pattern:** `infrastructure/lib/storage-stack.ts` (execBriefQueue)
