# RFP Document Approval Process — Architecture <!-- ⏳ PENDING -->

> Implementation-ready architecture for the end-to-end RFP document approval pipeline.
> This document covers the business workflow, existing implementation, identified gaps, and new features needed.

---

## 0. Business Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                  RFP Document Approval — Business Pipeline                       │
│                                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────────┐ │
│  │  1. PREPARE   │────▶│  2. REQUEST  │────▶│  3. REVIEW   │────▶│ 4. DECIDE  │ │
│  │  Documents    │     │  Review      │     │  Documents   │     │ Approve /  │ │
│  │              │     │              │     │              │     │ Reject     │ │
│  └──────────────┘     └──────────────┘     └──────────────┘     └─────┬──────┘ │
│                                                                       │        │
│                              ┌────────────────────────────────────────┤        │
│                              │                                        │        │
│                              ▼                                        ▼        │
│                    ┌──────────────────┐                    ┌──────────────────┐ │
│                    │  4a. REJECTED    │                    │  4b. APPROVED    │ │
│                    │                  │                    │                  │ │
│                    │ • Reason required │                    │ • signatureStatus│ │
│                    │ • Linear ticket  │                    │   → FULLY_SIGNED │ │
│                    │   reassigned to  │                    │ • Notification   │ │
│                    │   requester      │                    │   sent           │ │
│                    │ • Notification   │                    │ • Submission     │ │
│                    │   sent           │                    │   UNBLOCKED      │ │
│                    │ • signatureStatus│                    │                  │ │
│                    │   → PENDING_SIG  │                    └──────────────────┘ │
│                    │                  │                                         │
│                    └────────┬─────────┘                                         │
│                             │                                                   │
│                             ▼                                                   │
│                    ┌──────────────────┐                                         │
│                    │  5. FIX & RE-    │                                         │
│                    │  SUBMIT FOR      │                                         │
│                    │  REVIEW          │                                         │
│                    │                  │                                         │
│                    │ Employee fixes   │                                         │
│                    │ document, then   │──────────▶ Back to step 3               │
│                    │ re-submits from  │           (same approval record)         │
│                    │ same approval    │                                         │
│                    └──────────────────┘                                         │
│                                                                                 │
│  ═══════════════════════════════════════════════════════════════════════════════ │
│                                                                                 │
│  Once ALL documents are APPROVED (FULLY_SIGNED or NOT_REQUIRED):               │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  SUBMISSION UNBLOCKED → Employee can submit proposal to agency          │   │
│  │  (Readiness Check 8: "All documents approved" ✅)                       │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Actors

| Actor | Role | Actions |
|---|---|---|
| **Employee** (Proposal Creator) | Prepares RFP documents | Create/edit documents, request review, fix rejected documents, re-submit for review |
| **Reviewer** (Any org member) | Reviews documents | Receive Linear ticket + notification, visit document page, approve or reject with reason |

### Key Business Rules

1. **Any organization member** can be selected as a reviewer (except the requester themselves)
2. **Rejection requires a reason** — the reviewer must explain what needs to change
3. **Rejection reassigns the Linear ticket** back to the requester with the rejection reason
4. **Approval updates the document's `signatureStatus`** to `FULLY_SIGNED`, which unblocks submission
5. **Rejection resets the document's `signatureStatus`** to `PENDING_SIGNATURE`, which re-blocks submission
6. **Re-review is supported** — after rejection and fix, the employee can re-submit the same approval record for review (no new approval request needed)
7. **Bulk approval** — reviewer can approve or reject all pending documents at once
8. **Submission is blocked** until ALL documents have `signatureStatus = FULLY_SIGNED` or `NOT_REQUIRED`

---

## 1. Current State — What Already Exists

### ✅ Fully Implemented

| Component | Location | Status |
|---|---|---|
| **Document Approval Schema** | `packages/core/src/schemas/document-approval.ts` | ✅ Complete |
| — `DocumentApprovalStatusSchema` | PENDING, APPROVED, REJECTED, CANCELLED | ✅ |
| — `RequestDocumentApprovalSchema` | orgId, projectId, opportunityId, documentId, reviewerId | ✅ |
| — `SubmitDocumentReviewSchema` | Discriminated union: APPROVED (note optional), REJECTED (note required) | ✅ |
| **Request Approval Handler** | `apps/functions/src/handlers/document-approval/request-approval.ts` | ✅ Complete |
| — Creates approval record in DynamoDB | | ✅ |
| — Creates Linear ticket for reviewer | Title: `[Review] {docName} — Approval Required` | ✅ |
| — Sends notification to reviewer | Type: `DOCUMENT_APPROVAL_REQUESTED` | ✅ |
| — Cancels any existing PENDING approvals for same document | | ✅ |
| — Guard: cannot request approval from yourself | | ✅ |
| **Submit Review Handler** | `apps/functions/src/handlers/document-approval/submit-review.ts` | ✅ Complete |
| — Updates approval record status | APPROVED or REJECTED | ✅ |
| — Reassigns Linear ticket back to requester | With review decision as comment | ✅ |
| — Sends notification to requester | Type: `DOCUMENT_APPROVED` or `DOCUMENT_REJECTED` | ✅ |
| — Guard: only assigned reviewer can submit | | ✅ |
| **Get Approval History Handler** | `apps/functions/src/handlers/document-approval/get-approval-history.ts` | ✅ Complete |
| **Document Approval Helper** | `apps/functions/src/helpers/document-approval.ts` | ✅ Complete |
| — DynamoDB CRUD (create, get, list, update status, update Linear ticket) | | ✅ |
| — Cancel pending approvals | | ✅ |
| **Linear Integration** | `apps/functions/src/helpers/linear.ts` | ✅ Complete |
| — `createLinearTicket()` | Creates ticket with labels | ✅ |
| — `reassignLinearTicket()` | Reassigns + adds comment | ✅ |
| **Notification System** | `apps/functions/src/helpers/send-notification.ts` | ✅ Complete |
| — SQS-based notification queue | | ✅ |
| — Types: `DOCUMENT_APPROVAL_REQUESTED`, `DOCUMENT_APPROVED`, `DOCUMENT_REJECTED` | | ✅ |
| **Frontend: RequestApprovalButton** | `apps/web/features/document-approval/components/RequestApprovalButton.tsx` | ✅ |
| **Frontend: ReviewDecisionPanel** | `apps/web/features/document-approval/components/ReviewDecisionPanel.tsx` | ✅ |
| **Frontend: ApprovalHistoryCard** | `apps/web/features/document-approval/components/ApprovalHistoryCard.tsx` | ✅ |
| **Frontend: ApprovalStatusBadge** | `apps/web/features/document-approval/components/ApprovalStatusBadge.tsx` | ✅ |
| **Submission Readiness Check 8** | `apps/functions/src/helpers/proposal-submission.ts` | ✅ |
| — Blocks submission if any document has `signatureStatus ≠ FULLY_SIGNED/NOT_REQUIRED` | | ✅ |

### Audit Actions (already in schema)

| Action | When |
|---|---|
| `DOCUMENT_APPROVAL_REQUESTED` | Employee requests review |
| `DOCUMENT_APPROVED` | Reviewer approves |
| `DOCUMENT_REJECTED` | Reviewer rejects |
| `DOCUMENT_APPROVAL_CANCELLED` | Employee cancels pending approval |

---

## 2. Gaps Identified

### 🔴 Gap 1: Approval Does NOT Update Document `signatureStatus` (CRITICAL)

**Problem:** When a reviewer approves a document, the approval record changes to `APPROVED`, but the document's `signatureStatus` field remains unchanged. The submission readiness check (Check 8) looks at `signatureStatus`, not the approval record. This means **approval alone does not unblock submission**.

**Fix:** The `submit-review` handler must update the document's `signatureStatus`:
- **On APPROVED** → set `signatureStatus = 'FULLY_SIGNED'`
- **On REJECTED** → set `signatureStatus = 'PENDING_SIGNATURE'`

**Impact:** `apps/functions/src/handlers/document-approval/submit-review.ts`

---

### 🟡 Gap 2: No Re-Review Capability

**Problem:** After rejection, the employee must create a **new** approval request. The old approval record is permanently `REJECTED`. There's no way to re-submit the same document for re-review from the same approval record.

**Fix:** Add a new status `REVISION_REQUESTED` and a new handler `resubmit-for-review` that:
1. Changes the approval status from `REJECTED` → `REVISION_REQUESTED` → `PENDING`
2. Reassigns the Linear ticket back to the reviewer
3. Sends a notification to the reviewer

**Impact:** Schema change + new handler + frontend update

---

### 🟡 Gap 3: No Bulk Approval Flow

**Problem:** Currently, each document must be approved individually. For opportunities with many documents (5-10+), this is tedious for reviewers.

**Fix:** Add a new handler `bulk-review` that accepts an array of document approvals and processes them in batch.

**Impact:** New schema + new handler + new frontend component

---

## 3. Architecture — Changes Required

### 3.1 Data Model Changes

#### Schema Updates: `packages/core/src/schemas/document-approval.ts`

**Add `REVISION_REQUESTED` status:**

```typescript
export const DocumentApprovalStatusSchema = z.enum([
  'PENDING',              // Approval request sent, waiting for reviewer
  'APPROVED',             // Reviewer approved the document
  'REJECTED',             // Reviewer rejected the document
  'REVISION_REQUESTED',   // Employee fixed document, re-submitted for review (→ PENDING)
  'CANCELLED',            // Requester cancelled the approval request
]);
```

**Add `ResubmitForReviewSchema`:**

```typescript
export const ResubmitForReviewSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1),
  opportunityId: z.string().min(1),
  documentId:    z.string().min(1),
  approvalId:    z.string().uuid(),
  /** Optional note from the employee about what was fixed */
  revisionNote:  z.string().max(2000).optional(),
});
export type ResubmitForReview = z.infer<typeof ResubmitForReviewSchema>;
```

**Add `BulkSubmitDocumentReviewSchema`:**

```typescript
export const BulkReviewItemSchema = z.discriminatedUnion('decision', [
  z.object({
    documentId: z.string().min(1),
    approvalId: z.string().uuid(),
    decision:   z.literal('APPROVED'),
    reviewNote: z.string().max(2000).optional(),
  }),
  z.object({
    documentId: z.string().min(1),
    approvalId: z.string().uuid(),
    decision:   z.literal('REJECTED'),
    reviewNote: z.string().min(1, 'Rejection reason is required').max(2000),
  }),
]);
export type BulkReviewItem = z.infer<typeof BulkReviewItemSchema>;

export const BulkSubmitDocumentReviewSchema = z.object({
  orgId:         z.string().min(1),
  projectId:     z.string().min(1),
  opportunityId: z.string().min(1),
  reviews:       z.array(BulkReviewItemSchema).min(1).max(50),
});
export type BulkSubmitDocumentReview = z.infer<typeof BulkSubmitDocumentReviewSchema>;

export const BulkReviewResponseSchema = z.object({
  results: z.array(z.object({
    documentId: z.string(),
    approvalId: z.string(),
    decision:   z.enum(['APPROVED', 'REJECTED']),
    success:    z.boolean(),
    error:      z.string().optional(),
  })),
  totalApproved: z.number(),
  totalRejected: z.number(),
  totalFailed:   z.number(),
});
export type BulkReviewResponse = z.infer<typeof BulkReviewResponseSchema>;
```

#### Audit Schema Updates: `packages/core/src/schemas/audit.ts`

Add new audit actions:

```typescript
'DOCUMENT_REVISION_RESUBMITTED',   // Employee re-submitted rejected doc for review
'DOCUMENT_BULK_REVIEWED',          // Reviewer bulk-approved/rejected multiple docs
```

---

### 3.2 Backend Changes

#### 3.2.1 FIX: `submit-review.ts` — Update Document `signatureStatus` on Approval/Rejection

**File:** `apps/functions/src/handlers/document-approval/submit-review.ts`

**Change:** After updating the approval record, also update the document's `signatureStatus`:

```typescript
import { updateRFPDocumentMetadata } from '@/helpers/rfp-document';

// After: const updated = await updateApprovalStatus(...)

// ── Update document signatureStatus based on decision ──
const newSignatureStatus = data.decision === 'APPROVED' ? 'FULLY_SIGNED' : 'PENDING_SIGNATURE';
updateRFPDocumentMetadata({
  projectId: data.projectId,
  documentId: data.documentId,
  updates: { signatureStatus: newSignatureStatus },
  updatedBy: reviewerId,
}).catch((err) =>
  console.warn('[submit-review] Failed to update document signatureStatus:', (err as Error).message),
);
```

**Why non-blocking?** The approval record is the source of truth. The `signatureStatus` update is a derived side-effect. If it fails, the approval record still reflects the correct state, and a retry or manual fix can resolve it.

**However**, since `signatureStatus` gates submission (blocking check), we should make this **blocking** (use `await`) to ensure consistency:

```typescript
// ── Update document signatureStatus based on decision (BLOCKING — gates submission) ──
try {
  const newSignatureStatus = data.decision === 'APPROVED' ? 'FULLY_SIGNED' : 'PENDING_SIGNATURE';
  await updateRFPDocumentMetadata({
    projectId: data.projectId,
    documentId: data.documentId,
    updates: { signatureStatus: newSignatureStatus },
    updatedBy: reviewerId,
  });
} catch (err) {
  console.error('[submit-review] CRITICAL: Failed to update document signatureStatus:', err);
  // Don't fail the entire review — the approval record is already updated
  // The signatureStatus can be fixed manually or via a retry
}
```

---

#### 3.2.2 NEW: `resubmit-for-review.ts` — Re-Review After Rejection

**File:** `apps/functions/src/handlers/document-approval/resubmit-for-review.ts`

**Flow:**
1. Validate input with `ResubmitForReviewSchema`
2. Load approval record — must be in `REJECTED` status
3. Guard: only the original requester can re-submit
4. Update approval status: `REJECTED` → `PENDING` (reset `reviewedAt`, `reviewNote`)
5. Reassign Linear ticket back to the reviewer
6. Send notification to reviewer: "Document revised and re-submitted for review"
7. Write audit log

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalRecord, updateApprovalStatus } from '@/helpers/document-approval';
import { getRFPDocument } from '@/helpers/rfp-document';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { reassignLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { ResubmitForReviewSchema } from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = ResubmitForReviewSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId;

  // ── Load approval record ──
  const approval = await getApprovalRecord(
    orgId, data.projectId, data.opportunityId, data.documentId, data.approvalId,
  );
  if (!approval) return apiResponse(404, { message: 'Approval request not found' });

  // ── Guard: only REJECTED approvals can be re-submitted ──
  if (approval.status !== 'REJECTED') {
    return apiResponse(409, {
      message: `Cannot re-submit — approval is ${approval.status.toLowerCase()}, not rejected`,
    });
  }

  // ── Guard: only the original requester can re-submit ──
  if (approval.requestedBy !== userId) {
    return apiResponse(403, { message: 'Only the original requester can re-submit for review' });
  }

  // ── Load document ──
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc['deletedAt']) return apiResponse(404, { message: 'Document not found' });

  // ── Reset approval to PENDING ──
  const updated = await updateApprovalStatus(
    orgId, data.projectId, data.opportunityId, data.documentId, data.approvalId,
    {
      status: 'PENDING',
      // Clear previous review data
      reviewedAt: undefined,
      reviewNote: undefined,
    },
  );

  // ── Reassign Linear ticket back to reviewer (non-blocking) ──
  if (approval.linearTicketId) {
    const commentBody = [
      `## 🔄 Document Revised — Re-Review Requested`,
      ``,
      `**Requester:** ${userName}`,
      ...(data.revisionNote ? [`**Revision Note:** ${data.revisionNote}`] : []),
      ``,
      `The document has been revised and re-submitted for your review.`,
    ].join('\n');

    reassignLinearTicket(
      orgId,
      approval.linearTicketId,
      approval.reviewerId,
      commentBody,
    ).catch((err) =>
      console.warn('[resubmit-for-review] Linear reassignment failed:', (err as Error).message),
    );
  }

  // ── Notify reviewer (non-blocking) ──
  const reviewer = await getUserByOrgAndId(orgId, approval.reviewerId).catch(() => null);
  sendNotification(
    buildNotification(
      'DOCUMENT_APPROVAL_REQUESTED',
      '🔄 Document Revised — Re-Review Requested',
      `${userName} has revised "${doc['name'] ?? doc['title'] ?? 'a document'}" and re-submitted it for your review`,
      {
        orgId,
        projectId: data.projectId,
        entityId: data.documentId,
        recipientUserIds: [approval.reviewerId],
        recipientEmails: reviewer?.email ? [reviewer.email] : [],
        actorDisplayName: userName,
      },
    ),
  ).catch((err) =>
    console.warn('[resubmit-for-review] Notification failed:', (err as Error).message),
  );

  // ── Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId,
      userName,
      organizationId: orgId,
      action: 'DOCUMENT_REVISION_RESUBMITTED',
      resource: 'document',
      resourceId: data.documentId,
      changes: {
        before: { status: 'REJECTED' },
        after: { status: 'PENDING', revisionNote: data.revisionNote },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) =>
    console.warn('[resubmit-for-review] Audit log failed:', (err as Error).message),
  );

  setAuditContext(event, {
    action: 'DOCUMENT_REVISION_RESUBMITTED',
    resource: 'document',
    resourceId: data.documentId,
    orgId,
  });

  return apiResponse(200, { ok: true, approval: updated });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

#### 3.2.3 NEW: `bulk-review.ts` — Bulk Approve/Reject Multiple Documents

**File:** `apps/functions/src/handlers/document-approval/bulk-review.ts`

**Flow:**
1. Validate input with `BulkSubmitDocumentReviewSchema`
2. For each review item, process individually (reuse existing logic):
   a. Load approval record — must be PENDING
   b. Guard: reviewer must be the assigned reviewer
   c. Update approval status
   d. Update document `signatureStatus`
   e. Reassign Linear ticket (non-blocking)
   f. Send notification (non-blocking)
   g. Write audit log (non-blocking)
3. Return aggregated results

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalRecord, updateApprovalStatus } from '@/helpers/document-approval';
import { updateRFPDocumentMetadata } from '@/helpers/rfp-document';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { reassignLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { BulkSubmitDocumentReviewSchema } from '@auto-rfp/core';
import type { BulkReviewItem } from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

interface BulkReviewResult {
  documentId: string;
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  success: boolean;
  error?: string;
}

const processReview = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  review: BulkReviewItem,
  reviewerId: string,
  reviewerName: string,
): Promise<BulkReviewResult> => {
  try {
    // Load approval record
    const approval = await getApprovalRecord(
      orgId, projectId, opportunityId, review.documentId, review.approvalId,
    );
    if (!approval) {
      return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: 'Approval not found' };
    }
    if (approval.status !== 'PENDING') {
      return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: `Already ${approval.status.toLowerCase()}` };
    }
    if (approval.reviewerId !== reviewerId) {
      return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: 'Not the assigned reviewer' };
    }

    const now = nowIso();

    // Update approval record
    await updateApprovalStatus(
      orgId, projectId, opportunityId, review.documentId, review.approvalId,
      { status: review.decision, reviewedAt: now, reviewNote: review.reviewNote },
    );

    // Update document signatureStatus (blocking — gates submission)
    const newSignatureStatus = review.decision === 'APPROVED' ? 'FULLY_SIGNED' : 'PENDING_SIGNATURE';
    await updateRFPDocumentMetadata({
      projectId,
      documentId: review.documentId,
      updates: { signatureStatus: newSignatureStatus },
      updatedBy: reviewerId,
    });

    // Reassign Linear ticket (non-blocking)
    if (approval.linearTicketId) {
      const decisionLabel = review.decision === 'APPROVED' ? '✅ Approved' : '❌ Rejected';
      const commentBody = [
        `## ${decisionLabel} (Bulk Review)`,
        `**Reviewer:** ${reviewerName}`,
        ...(review.reviewNote ? [`**Note:** ${review.reviewNote}`] : []),
      ].join('\n');

      reassignLinearTicket(orgId, approval.linearTicketId, approval.requestedBy, commentBody)
        .catch((err) => console.warn(`[bulk-review] Linear reassignment failed for ${review.documentId}:`, (err as Error).message));
    }

    // Notify requester (non-blocking)
    const notificationType = review.decision === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED';
    const notificationTitle = review.decision === 'APPROVED' ? '✅ Document Approved' : '❌ Document Rejected';
    sendNotification(
      buildNotification(notificationType, notificationTitle,
        `${reviewerName} ${review.decision.toLowerCase()} "${approval.documentName ?? 'a document'}"${review.reviewNote ? `: ${review.reviewNote}` : ''}`,
        {
          orgId, projectId, entityId: review.documentId,
          recipientUserIds: [approval.requestedBy],
          actorDisplayName: reviewerName,
        },
      ),
    ).catch((err) => console.warn(`[bulk-review] Notification failed for ${review.documentId}:`, (err as Error).message));

    return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: true };
  } catch (err) {
    return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: (err as Error).message };
  }
};

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = BulkSubmitDocumentReviewSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const reviewerId = getUserId(event) ?? 'system';
  const reviewerName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? reviewerId;

  // Process all reviews in parallel
  const results = await Promise.all(
    data.reviews.map((review) =>
      processReview(orgId, data.projectId, data.opportunityId, review, reviewerId, reviewerName),
    ),
  );

  const totalApproved = results.filter((r) => r.success && r.decision === 'APPROVED').length;
  const totalRejected = results.filter((r) => r.success && r.decision === 'REJECTED').length;
  const totalFailed = results.filter((r) => !r.success).length;

  // Audit log (non-blocking)
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: reviewerId,
      userName: reviewerName,
      organizationId: orgId,
      action: 'DOCUMENT_BULK_REVIEWED',
      resource: 'document',
      resourceId: `bulk-${data.projectId}-${data.opportunityId}`,
      changes: {
        after: { totalApproved, totalRejected, totalFailed, documentIds: data.reviews.map((r) => r.documentId) },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: totalFailed === 0 ? 'success' : 'partial_failure',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[bulk-review] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: 'DOCUMENT_BULK_REVIEWED',
    resource: 'document',
    resourceId: `bulk-${data.projectId}-${data.opportunityId}`,
    orgId,
  });

  return apiResponse(200, { results, totalApproved, totalRejected, totalFailed });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

#### 3.2.4 Helper Updates: `document-approval.ts`

**Add `resetApprovalForReReview`:**

```typescript
/**
 * Reset a REJECTED approval back to PENDING for re-review.
 * Clears the previous review data (reviewedAt, reviewNote).
 */
export const resetApprovalForReReview = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  approvalId: string,
  revisionNote?: string,
): Promise<DocumentApprovalItem> => {
  const sk = buildApprovalSk(orgId, projectId, opportunityId, documentId, approvalId);
  const now = nowIso();

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: DOCUMENT_APPROVAL_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #status = :status, #updatedAt = :now, #revisionNote = :revisionNote REMOVE #reviewedAt, #reviewNote',
      ConditionExpression: '#status = :rejected',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#revisionNote': 'revisionNote',
        '#reviewedAt': 'reviewedAt',
        '#reviewNote': 'reviewNote',
      },
      ExpressionAttributeValues: {
        ':status': 'PENDING',
        ':now': now,
        ':revisionNote': revisionNote ?? null,
        ':rejected': 'REJECTED',
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes as DocumentApprovalItem;
};
```

---

### 3.3 REST API Routes

#### Updated Route Registration

**File:** `packages/infra/api/routes/document-approval.routes.ts`

Add new routes:

| Method | Path | Permission | Description | Status |
|---|---|---|---|---|
| `POST` | `/document-approval/request` | `proposal:edit` | Request approval for a document | ✅ Exists |
| `POST` | `/document-approval/review` | `proposal:edit` | Submit review (approve/reject) | ✅ Exists |
| `GET` | `/document-approval/history` | `proposal:read` | Get approval history for a document | ✅ Exists |
| `POST` | `/document-approval/resubmit` | `proposal:edit` | Re-submit rejected doc for review | 🆕 New |
| `POST` | `/document-approval/bulk-review` | `proposal:edit` | Bulk approve/reject multiple docs | 🆕 New |

```typescript
// Add to existing routes:
{ method: 'POST', path: 'resubmit',    entry: lambdaEntry('document-approval/resubmit-for-review.ts') },
{ method: 'POST', path: 'bulk-review', entry: lambdaEntry('document-approval/bulk-review.ts') },
```

---

### 3.4 Frontend Changes

#### 3.4.1 New Hook: `useResubmitForReview.ts`

**File:** `apps/web/features/document-approval/hooks/useResubmitForReview.ts`

```typescript
'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ResubmitForReview, DocumentApprovalResponse } from '@auto-rfp/core';

export const useResubmitForReview = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resubmit = async (
    dto: ResubmitForReview,
  ): Promise<DocumentApprovalResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<DocumentApprovalResponse>(
        buildApiUrl('document-approval/resubmit'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-submit for review');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { resubmit, isLoading, error };
};
```

#### 3.4.2 New Hook: `useBulkReview.ts`

**File:** `apps/web/features/document-approval/hooks/useBulkReview.ts`

```typescript
'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { BulkSubmitDocumentReview, BulkReviewResponse } from '@auto-rfp/core';

export const useBulkReview = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bulkReview = async (
    dto: BulkSubmitDocumentReview,
  ): Promise<BulkReviewResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<BulkReviewResponse>(
        buildApiUrl('document-approval/bulk-review'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit bulk review');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { bulkReview, isLoading, error };
};
```

#### 3.4.3 New Component: `ResubmitForReviewButton.tsx`

**File:** `apps/web/features/document-approval/components/ResubmitForReviewButton.tsx`

A button shown to the **requester** when a document has been rejected. Opens a dialog to add a revision note and re-submit for review.

```typescript
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useResubmitForReview } from '../hooks/useResubmitForReview';
import type { DocumentApprovalItem } from '@auto-rfp/core';

interface ResubmitForReviewButtonProps {
  approval: DocumentApprovalItem;
  currentUserId: string;
  onSuccess?: () => void;
}

export const ResubmitForReviewButton = ({
  approval,
  currentUserId,
  onSuccess,
}: ResubmitForReviewButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const { resubmit, isLoading } = useResubmitForReview();
  const { toast } = useToast();

  // Only the original requester can re-submit, and only for REJECTED approvals
  if (approval.requestedBy !== currentUserId) return null;
  if (approval.status !== 'REJECTED') return null;

  const handleResubmit = async () => {
    const result = await resubmit({
      orgId: approval.orgId,
      projectId: approval.projectId,
      opportunityId: approval.opportunityId,
      documentId: approval.documentId,
      approvalId: approval.approvalId,
      revisionNote: revisionNote.trim() || undefined,
    });

    if (result) {
      toast({
        title: '🔄 Re-Submitted for Review',
        description: `The document has been re-submitted to ${approval.reviewerName ?? 'the reviewer'} for review.`,
      });
      setShowDialog(false);
      setRevisionNote('');
      onSuccess?.();
    } else {
      toast({
        title: 'Re-Submit Failed',
        description: 'Could not re-submit for review. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowDialog(true)}
        className="gap-2"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Re-Submit for Review
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Re-Submit for Review
            </DialogTitle>
            <DialogDescription>
              Re-submit <span className="font-medium text-foreground">{approval.documentName ?? 'this document'}</span>{' '}
              to {approval.reviewerName ?? 'the reviewer'} for another review.
              {approval.reviewNote && (
                <span className="block mt-2 text-amber-700 bg-amber-50 p-2 rounded text-xs">
                  <strong>Previous rejection reason:</strong> {approval.reviewNote}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>
              Revision Note
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </Label>
            <Textarea
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Describe what you changed to address the reviewer's feedback…"
              rows={3}
              disabled={isLoading}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleResubmit} disabled={isLoading} className="gap-2">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Re-Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
```

#### 3.4.4 New Component: `BulkReviewPanel.tsx`

**File:** `apps/web/features/document-approval/components/BulkReviewPanel.tsx`

A panel shown to the reviewer when they have multiple pending approvals for the same opportunity. Allows approving or rejecting all at once.

```typescript
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, XCircle, Loader2, ListChecks, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useBulkReview } from '../hooks/useBulkReview';
import type { DocumentApprovalItem } from '@auto-rfp/core';

interface BulkReviewPanelProps {
  pendingApprovals: DocumentApprovalItem[];
  currentUserId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  onSuccess?: () => void;
}

export const BulkReviewPanel = ({
  pendingApprovals,
  currentUserId,
  orgId,
  projectId,
  opportunityId,
  onSuccess,
}: BulkReviewPanelProps) => {
  // Filter to only approvals assigned to the current user
  const myPendingApprovals = pendingApprovals.filter(
    (a) => a.reviewerId === currentUserId && a.status === 'PENDING',
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(myPendingApprovals.map((a) => a.approvalId)),
  );
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState('');
  const { bulkReview, isLoading } = useBulkReview();
  const { toast } = useToast();

  if (myPendingApprovals.length < 2) return null; // Only show for 2+ pending

  const toggleSelection = (approvalId: string) => {
    const next = new Set(selectedIds);
    if (next.has(approvalId)) next.delete(approvalId);
    else next.add(approvalId);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === myPendingApprovals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(myPendingApprovals.map((a) => a.approvalId)));
    }
  };

  const selectedApprovals = myPendingApprovals.filter((a) => selectedIds.has(a.approvalId));

  const handleBulkApprove = async () => {
    if (selectedApprovals.length === 0) return;

    const result = await bulkReview({
      orgId,
      projectId,
      opportunityId,
      reviews: selectedApprovals.map((a) => ({
        documentId: a.documentId,
        approvalId: a.approvalId,
        decision: 'APPROVED' as const,
      })),
    });

    if (result) {
      toast({
        title: `✅ ${result.totalApproved} Document(s) Approved`,
        description: result.totalFailed > 0
          ? `${result.totalFailed} failed — check individual documents`
          : 'All selected documents have been approved.',
      });
      onSuccess?.();
    }
  };

  const handleBulkReject = async () => {
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectReasonError('Rejection reason is required');
      return;
    }
    setRejectReasonError('');

    const result = await bulkReview({
      orgId,
      projectId,
      opportunityId,
      reviews: selectedApprovals.map((a) => ({
        documentId: a.documentId,
        approvalId: a.approvalId,
        decision: 'REJECTED' as const,
        reviewNote: trimmed,
      })),
    });

    if (result) {
      toast({
        title: `❌ ${result.totalRejected} Document(s) Rejected`,
        description: 'The requester has been notified with your rejection reason.',
      });
      setShowRejectDialog(false);
      setRejectReason('');
      onSuccess?.();
    }
  };

  return (
    <>
      <Card className="border-indigo-200 bg-indigo-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-indigo-600" />
            Bulk Review
            <Badge variant="outline" className="border-indigo-300 text-indigo-700 text-xs">
              {myPendingApprovals.length} pending
            </Badge>
          </CardTitle>
          <CardDescription>
            You have {myPendingApprovals.length} documents pending your review. Select documents and approve or reject them in bulk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Select all toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === myPendingApprovals.length}
              onCheckedChange={toggleAll}
            />
            <span className="text-xs text-muted-foreground">
              Select all ({selectedIds.size}/{myPendingApprovals.length})
            </span>
          </div>

          {/* Document list */}
          <div className="space-y-1.5">
            {myPendingApprovals.map((a) => (
              <div
                key={a.approvalId}
                className="flex items-center gap-2 p-2 rounded border bg-white"
              >
                <Checkbox
                  checked={selectedIds.has(a.approvalId)}
                  onCheckedChange={() => toggleSelection(a.approvalId)}
                />
                <span className="text-sm flex-1 truncate">
                  {a.documentName ?? a.documentId}
                </span>
                <Badge variant="outline" className="text-xs">Pending</Badge>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleBulkApprove}
              disabled={isLoading || selectedIds.size === 0}
              className="gap-2 flex-1 bg-emerald-600 hover:bg-emerald-700"
              size="sm"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve Selected ({selectedIds.size})
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowRejectDialog(true)}
              disabled={isLoading || selectedIds.size === 0}
              className="gap-2 flex-1"
              size="sm"
            >
              <XCircle className="h-4 w-4" />
              Reject Selected ({selectedIds.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk rejection dialog */}
      <Dialog
        open={showRejectDialog}
        onOpenChange={(open) => {
          setShowRejectDialog(open);
          if (!open) { setRejectReason(''); setRejectReasonError(''); }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Reject {selectedIds.size} Document(s)
            </DialogTitle>
            <DialogDescription>
              This rejection reason will be applied to all {selectedIds.size} selected document(s).
              Each requester will be notified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Textarea
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (e.target.value.trim()) setRejectReasonError('');
              }}
              placeholder="Describe what needs to be changed…"
              rows={4}
              disabled={isLoading}
              className={rejectReasonError ? 'border-destructive' : ''}
            />
            {rejectReasonError && (
              <p className="text-xs text-destructive">{rejectReasonError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkReject}
              disabled={isLoading || !rejectReason.trim()}
              className="gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Reject All Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
```

#### 3.4.5 Updated Barrel Export

**File:** `apps/web/features/document-approval/index.ts`

```typescript
// Existing exports
export { RequestApprovalButton } from './components/RequestApprovalButton';
export { ReviewDecisionPanel } from './components/ReviewDecisionPanel';
export { ApprovalStatusBadge } from './components/ApprovalStatusBadge';
export { ApprovalHistoryCard } from './components/ApprovalHistoryCard';
export { useApprovalHistory } from './hooks/useApprovalHistory';
export { useRequestApproval } from './hooks/useRequestApproval';
export { useSubmitReview } from './hooks/useSubmitReview';

// New exports
export { ResubmitForReviewButton } from './components/ResubmitForReviewButton';
export { BulkReviewPanel } from './components/BulkReviewPanel';
export { useResubmitForReview } from './hooks/useResubmitForReview';
export { useBulkReview } from './hooks/useBulkReview';
```

---

## 4. Complete Pipeline Flow — Sequence Diagram

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Employee  │     │ Auto RFP │     │ DynamoDB  │     │  Linear  │     │ Reviewer │
│ (Browser) │     │ (Lambda) │     │           │     │          │     │ (Browser)│
└────┬──────┘     └────┬─────┘     └────┬──────┘     └────┬─────┘     └────┬─────┘
     │                  │               │                  │               │
     │ 1. Click "Request Review"        │                  │               │
     │ Select reviewer ─▶               │                  │               │
     │                  │               │                  │               │
     │                  │ 2. POST /document-approval/request               │
     │                  │──────────────▶│                  │               │
     │                  │  Create approval record (PENDING)│               │
     │                  │               │                  │               │
     │                  │ 3. Create Linear ticket ────────▶│               │
     │                  │  "[Review] Doc Name — Approval Required"         │
     │                  │               │                  │               │
     │                  │ 4. Send notification (SQS) ──────────────────────▶
     │                  │  "📋 Document Review Requested"  │               │
     │                  │               │                  │               │
     │  ◀── 200 OK ────│               │                  │               │
     │                  │               │                  │               │
     │                  │               │                  │  5. Reviewer  │
     │                  │               │                  │  sees Linear  │
     │                  │               │                  │  ticket + in- │
     │                  │               │                  │  app notif    │
     │                  │               │                  │               │
     │                  │               │                  │  6. Visits    │
     │                  │               │                  │  document page│
     │                  │               │                  │  ◀────────────│
     │                  │               │                  │               │
     │                  │               │                  │  7a. APPROVE  │
     │                  │  POST /document-approval/review  │  ◀────────────│
     │                  │◀─────────────────────────────────────────────────│
     │                  │               │                  │               │
     │                  │ 8a. Update approval → APPROVED   │               │
     │                  │──────────────▶│                  │               │
     │                  │               │                  │               │
     │                  │ 9a. Update doc signatureStatus → FULLY_SIGNED    │
     │                  │──────────────▶│                  │               │
     │                  │               │                  │               │
     │                  │ 10a. Reassign Linear ticket ────▶│               │
     │                  │  "✅ Approved" comment            │               │
     │                  │               │                  │               │
     │  ◀── Notification "✅ Document Approved"            │               │
     │                  │               │                  │               │
     │  ═══════════════════════════════════════════════════════════════════│
     │  SUBMISSION NOW UNBLOCKED (if all docs approved)    │               │
     │  ═══════════════════════════════════════════════════════════════════│
     │                  │               │                  │               │
     │                  │               │                  │  7b. REJECT   │
     │                  │  POST /document-approval/review  │  ◀────────────│
     │                  │◀─────────────────────────────────────────────────│
     │                  │  { decision: "REJECTED", reviewNote: "..." }     │
     │                  │               │                  │               │
     │                  │ 8b. Update approval → REJECTED   │               │
     │                  │──────────────▶│                  │               │
     │                  │               │                  │               │
     │                  │ 9b. Update doc signatureStatus → PENDING_SIGNATURE
     │                  │──────────────▶│                  │               │
     │                  │               │                  │               │
     │                  │ 10b. Reassign Linear ticket ────▶│               │
     │                  │  "❌ Rejected: {reason}" comment  │               │
     │                  │               │                  │               │
     │  ◀── Notification "❌ Document Rejected: {reason}"  │               │
     │                  │               │                  │               │
     │  ═══════════════════════════════════════════════════════════════════│
     │  SUBMISSION BLOCKED (signatureStatus = PENDING_SIGNATURE)           │
     │  ═══════════════════════════════════════════════════════════════════│
     │                  │               │                  │               │
     │ 11. Employee fixes document      │                  │               │
     │ 12. Click "Re-Submit for Review" │                  │               │
     │─────────────────▶│               │                  │               │
     │                  │ POST /document-approval/resubmit │               │
     │                  │──────────────▶│                  │               │
     │                  │  Reset approval → PENDING        │               │
     │                  │               │                  │               │
     │                  │ Reassign Linear ticket ─────────▶│               │
     │                  │  "🔄 Document Revised" comment   │               │
     │                  │               │                  │               │
     │                  │ Send notification ───────────────────────────────▶
     │                  │  "🔄 Document Revised — Re-Review Requested"     │
     │                  │               │                  │               │
     │                  │               │                  │  Back to 6.   │
     │                  │               │                  │  Review again │
```

---

## 5. DynamoDB Design

### Existing Access Patterns (no changes)

| Entity | PK | SK | Notes |
|---|---|---|---|
| Document Approval | `DOCUMENT_APPROVAL` | `{orgId}#{projectId}#{opportunityId}#{documentId}#{approvalId}` | One record per approval request |

### New Fields on Approval Record

| Field | Type | Description |
|---|---|---|
| `revisionNote` | `string?` | Note from employee about what was fixed (set on re-submit) |

### Document `signatureStatus` Values (existing, no changes)

| Value | Meaning | Submission Impact |
|---|---|---|
| `NOT_REQUIRED` | Document doesn't need approval | ✅ Unblocked |
| `PENDING_SIGNATURE` | Awaiting approval | ❌ Blocked |
| `PARTIALLY_SIGNED` | Some approvals done | ❌ Blocked |
| `FULLY_SIGNED` | All approvals complete | ✅ Unblocked |
| `REJECTED` | Approval rejected | ❌ Blocked |

---

## 6. Implementation Tickets

### DA-1 · CRITICAL FIX: Approval → Update Document `signatureStatus` (1h)

**Priority: P0 — This is a bug that breaks the approval→submission pipeline**

**Files to modify:**
- `apps/functions/src/handlers/document-approval/submit-review.ts`

**Changes:**
1. Import `updateRFPDocumentMetadata` from `@/helpers/rfp-document`
2. After updating approval status, update document `signatureStatus`:
   - APPROVED → `FULLY_SIGNED`
   - REJECTED → `PENDING_SIGNATURE`
3. Make the `signatureStatus` update **blocking** (use `await`) since it gates submission

**Tests to add/update:**
- `submit-review.test.ts` — verify `signatureStatus` is updated on approve/reject

---

### DA-2 · Schema Updates (30min)

**Files to modify:**
- `packages/core/src/schemas/document-approval.ts`
  - Add `REVISION_REQUESTED` to `DocumentApprovalStatusSchema`
  - Add `ResubmitForReviewSchema`
  - Add `BulkSubmitDocumentReviewSchema`, `BulkReviewItemSchema`, `BulkReviewResponseSchema`
  - Add `revisionNote` to `DocumentApprovalItemSchema`
- `packages/core/src/schemas/audit.ts`
  - Add `DOCUMENT_REVISION_RESUBMITTED` and `DOCUMENT_BULK_REVIEWED` actions
- `packages/core/src/schemas/index.ts`
  - Ensure new types are exported

**Tests to add:**
- `document-approval.test.ts` — test new schemas

---

### DA-3 · Re-Submit for Review Handler (1.5h)

**Files to create:**
- `apps/functions/src/handlers/document-approval/resubmit-for-review.ts`

**Files to modify:**
- `apps/functions/src/helpers/document-approval.ts` — add `resetApprovalForReReview()`

**Tests to create:**
- `resubmit-for-review.test.ts`

---

### DA-4 · Bulk Review Handler (1.5h)

**Files to create:**
- `apps/functions/src/handlers/document-approval/bulk-review.ts`

**Tests to create:**
- `bulk-review.test.ts`

---

### DA-5 · CDK Route Registration (30min)

**Files to modify:**
- `packages/infra/api/routes/document-approval.routes.ts` — add 2 new routes
- `packages/infra/api/api-orchestrator-stack.ts` — add log groups for new handlers

---

### DA-6 · Frontend: Re-Submit for Review (1h)

**Files to create:**
- `apps/web/features/document-approval/hooks/useResubmitForReview.ts`
- `apps/web/features/document-approval/components/ResubmitForReviewButton.tsx`

**Files to modify:**
- `apps/web/features/document-approval/index.ts` — add exports
- `apps/web/components/rfp-documents/rfp-document-card.tsx` — show `ResubmitForReviewButton` when approval is REJECTED and current user is the requester

---

### DA-7 · Frontend: Bulk Review Panel (1.5h)

**Files to create:**
- `apps/web/features/document-approval/hooks/useBulkReview.ts`
- `apps/web/features/document-approval/components/BulkReviewPanel.tsx`

**Files to modify:**
- `apps/web/features/document-approval/index.ts` — add exports
- `apps/web/components/rfp-documents/rfp-documents-content.tsx` — show `BulkReviewPanel` when reviewer has 2+ pending approvals

---

### DA-8 · Tests (1h)

**Files to create/update:**
- `packages/core/src/schemas/document-approval.test.ts` — new schema tests
- `apps/functions/src/handlers/document-approval/submit-review.test.ts` — update for signatureStatus
- `apps/functions/src/handlers/document-approval/resubmit-for-review.test.ts` — new
- `apps/functions/src/handlers/document-approval/bulk-review.test.ts` — new

---

## 7. Ticket Dependency Graph

```
DA-2 (Schemas) ──────┬──▶ DA-1 (Fix signatureStatus) ──▶ DA-8 (Tests)
                      │
                      ├──▶ DA-3 (Re-Submit Handler) ──┬──▶ DA-6 (FE: Re-Submit)
                      │                                │
                      ├──▶ DA-4 (Bulk Review Handler) ─┼──▶ DA-7 (FE: Bulk Review)
                      │                                │
                      └──▶ DA-5 (CDK Routes) ──────────┘
```

**Recommended order:**
1. **DA-2** (Schemas) — foundation for everything
2. **DA-1** (Fix signatureStatus) — critical bug fix, unblocks the pipeline
3. **DA-5** (CDK Routes) — infrastructure for new handlers
4. **DA-3** (Re-Submit Handler) — new feature
5. **DA-4** (Bulk Review Handler) — new feature
6. **DA-6** (FE: Re-Submit) — frontend for re-submit
7. **DA-7** (FE: Bulk Review) — frontend for bulk review
8. **DA-8** (Tests) — can be done in parallel with each ticket

**Total estimated effort: ~8.5 hours**

---

## 8. Acceptance Criteria

### Pipeline Flow
- [ ] Employee can prepare RFP documents and request review from any org member
- [ ] Reviewer receives a Linear ticket with document details and instructions
- [ ] Reviewer receives an in-app notification in Auto RFP
- [ ] Reviewer can visit the RFP documents page and see the review panel
- [ ] Reviewer can approve a document (optional note)
- [ ] Reviewer can reject a document (reason required)
- [ ] On approval: document `signatureStatus` → `FULLY_SIGNED`
- [ ] On rejection: document `signatureStatus` → `PENDING_SIGNATURE`
- [ ] On rejection: Linear ticket reassigned to requester with rejection reason
- [ ] On rejection: requester receives notification with rejection reason
- [ ] On approval: submission readiness check 8 passes for that document
- [ ] When ALL documents are approved: proposal submission is unblocked

### Re-Review Flow
- [ ] After rejection, employee sees "Re-Submit for Review" button
- [ ] Employee can add a revision note explaining what was fixed
- [ ] Re-submit resets approval to PENDING (same approval record)
- [ ] Linear ticket reassigned back to reviewer with revision note
- [ ] Reviewer receives notification about re-submitted document

### Bulk Review Flow
- [ ] When reviewer has 2+ pending approvals, bulk review panel appears
- [ ] Reviewer can select/deselect individual documents
- [ ] "Select All" toggle works
- [ ] Bulk approve: all selected documents approved in one action
- [ ] Bulk reject: rejection reason dialog, applied to all selected documents
- [ ] Each document's `signatureStatus` updated individually
- [ ] Each requester notified individually

### System Correctness
- [ ] Approval record status transitions: PENDING → APPROVED/REJECTED → (REJECTED → PENDING via re-submit)
- [ ] Only assigned reviewer can approve/reject
- [ ] Only original requester can re-submit for review
- [ ] Cannot request approval from yourself
- [ ] Rejection requires a reason (Zod validation)
- [ ] Audit logs written for all actions
- [ ] TypeScript compiles with no errors across all packages

---

## 9. Summary of All Files

### New Files

| File | Purpose |
|---|---|
| `apps/functions/src/handlers/document-approval/resubmit-for-review.ts` | Re-submit rejected doc for review |
| `apps/functions/src/handlers/document-approval/bulk-review.ts` | Bulk approve/reject multiple docs |
| `apps/web/features/document-approval/hooks/useResubmitForReview.ts` | Re-submit mutation hook |
| `apps/web/features/document-approval/hooks/useBulkReview.ts` | Bulk review mutation hook |
| `apps/web/features/document-approval/components/ResubmitForReviewButton.tsx` | Re-submit button + dialog |
| `apps/web/features/document-approval/components/BulkReviewPanel.tsx` | Bulk review panel |
| `apps/functions/src/handlers/document-approval/resubmit-for-review.test.ts` | Tests |
| `apps/functions/src/handlers/document-approval/bulk-review.test.ts` | Tests |

### Modified Files

| File | Change |
|---|---|
| `packages/core/src/schemas/document-approval.ts` | Add REVISION_REQUESTED status, ResubmitForReviewSchema, BulkSubmitDocumentReviewSchema, revisionNote field |
| `packages/core/src/schemas/audit.ts` | Add DOCUMENT_REVISION_RESUBMITTED, DOCUMENT_BULK_REVIEWED actions |
| `apps/functions/src/handlers/document-approval/submit-review.ts` | **CRITICAL**: Update document signatureStatus on approve/reject |
| `apps/functions/src/helpers/document-approval.ts` | Add resetApprovalForReReview() |
| `packages/infra/api/routes/document-approval.routes.ts` | Add 2 new routes |
| `apps/web/features/document-approval/index.ts` | Add new exports |
| `apps/web/components/rfp-documents/rfp-document-card.tsx` | Show ResubmitForReviewButton |
| `apps/web/components/rfp-documents/rfp-documents-content.tsx` | Show BulkReviewPanel |
