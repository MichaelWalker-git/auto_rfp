# Proposal Submission Process — Implementation Guide <!-- ⏳ PENDING -->

> Implementation-ready architecture document for the end-to-end proposal submission workflow.
> This feature completes the **proposal creation → submission** automation loop in Auto RFP.

---

## 0. The RFP Proposal Creator's Journey <!-- ⏳ PENDING -->

Auto RFP automates the full lifecycle of a government proposal response. Here is where **Proposal Submission** fits:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RFP Proposal Creator's Journey in Auto RFP               │
│                                                                             │
│  1. FIND          SAM.gov / DIBBS import → opportunity identified           │
│       ↓                                                                     │
│  2. QUALIFY       AI Executive Brief → GO / NO_GO scoring decision          │
│       ↓ (GO)                                                                │
│  3. PURSUE        Upload solicitation → AI extracts questions               │
│                   Team answers questions → AI generates proposal sections   │
│                   Team edits / reviews / signs documents                    │
│       ↓                                                                     │
│  4. ★ SUBMIT ★   ← THIS FEATURE                                            │
│                   Readiness checklist → Submit button → Record submission   │
│                   Confirmation number, portal URL, document snapshot        │
│                   → Stage: SUBMITTED, APN registration triggered            │
│       ↓                                                                     │
│  5. AWAIT AWARD   Agency evaluates proposals (weeks / months)               │
│                   No action needed in Auto RFP during this period           │
│       ↓                                                                     │
│  6. RECORD RESULT  ProjectOutcome: WON (contract #, value) or LOST          │
│                    → Stage: WON or LOST                                     │
│                    → FOIA request if LOST (competitive intelligence)        │
│                    → Debriefing if LOST                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why `ProjectOutcome.PENDING` is Wrong

The existing `ProjectOutcome.PENDING` status was a workaround — it was used to mean "we submitted the proposal." This conflates two separate events:

| Event | What it is | When it happens | Recorded by |
|---|---|---|---|
| **Proposal Submission** | The act of sending the proposal to the agency | Immediately when submitted | `ProposalSubmission` (new) |
| **Award Result** | Whether the agency selected us | Weeks/months after submission | `ProjectOutcome` (existing) |

**`ProjectOutcome` should only be set when the award decision is known.** The `PENDING` status is deprecated — the `SUBMITTED` opportunity stage replaces it.

---

## 1. Overview <!-- ⏳ PENDING -->

| Field | Value |
|---|---|
| **Feature Name** | Proposal Submission Process |
| **Domain** | `proposal-submission` |
| **Trigger** | Proposal creator clicks "Submit Proposal" after all required documents are ready |
| **Pre-conditions** | Required RFP documents exist, no generation in progress, no failed generation |
| **Post-conditions** | Submission record created, opportunity stage → `SUBMITTED`, APN registration triggered, team notified |
| **Audit** | Full audit trail for every submission attempt |
| **Frontend** | Readiness checklist + Submit button on opportunity detail page |

---

## 1a. Relationship: ProposalSubmission vs ProjectOutcome <!-- ⏳ PENDING -->

| | `ProposalSubmission` (new) | `ProjectOutcome` (existing) |
|---|---|---|
| **Records** | The act of submitting the proposal to the agency | The award result after the agency decides |
| **When set** | Immediately when the proposal creator submits | Weeks/months later when award is announced |
| **Key data** | Method, confirmation number, portal URL, document snapshot | Contract value, contract number, loss reason, winning contractor |
| **Status values** | `SUBMITTED`, `WITHDRAWN` | `WON`, `LOST`, `NO_BID`, `WITHDRAWN` |
| **Stage trigger** | `onProjectOutcomeSet('PENDING')` → stage `SUBMITTED` + APN | `WON`/`LOST` → terminal stages |
| **UI** | Submit button + readiness checklist on opportunity detail | "Set Outcome" button on opportunity detail (after award) |

### Impact on Existing Code

| File | Change |
|---|---|
| `submit-proposal.ts` | Call `onProjectOutcomeSet('PENDING')` directly — **do NOT call `setProjectOutcome(PENDING)`** |
| `SetProjectOutcomeDialog.tsx` | Remove `PENDING` from dropdown — proposal creators use "Submit Proposal" button instead |
| `ProjectOutcomeCard.tsx` | Keep as-is — still needed for WON/LOST/NO_BID/WITHDRAWN after award |
| `packages/core/src/schemas/project-outcome.ts` | Keep `PENDING` in schema for backward compatibility with existing DB records |

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Proposal Submission — System Flow                       │
│                                                                             │
│  Opportunity Detail Page (proposal creator's view)                          │
│       │                                                                     │
│       ▼                                                                     │
│  SubmissionChecklist card                                                   │
│  ── BLOCKING (must fix before submitting) ──────────────────────────────   │
│  ├── ✓ Opportunity is in PURSUING stage (not IDENTIFIED/QUALIFYING)        │
│  ├── ✓ Questions exist for this opportunity                                │
│  ├── ✓ All questions have answers (no unanswered questions)                │
│  ├── ✓ All answers are APPROVED (not DRAFT)                                │
│  ├── ✓ Required documents present (Technical + Cost Proposal)              │
│  ├── ✓ No documents still generating                                       │
│  ├── ✓ No failed document generation                                       │
│  ├── ✓ All documents approved (FULLY_SIGNED or NOT_REQUIRED)               │
│  ── WARNING (can submit anyway, but should review) ─────────────────────   │
│  ├── ⚠ Deadline not passed (warning — non-blocking)                       │
│  └── ⚠ Not already submitted (warning — allows re-submission)             │
│       │                                                                     │
│       ▼  (all blocking checks pass)                                         │
│  [Submit Proposal] button → opens confirmation dialog                      │
│  Dialog captures: method, confirmation #, portal URL, notes                │
│       │                                                                     │
│       ▼                                                                     │
│  POST /proposal-submission/submit                                           │
│       │                                                                     │
│       ├─ 1. Re-validate readiness server-side (prevents race conditions)   │
│       ├─ 2. Create ProposalSubmission record (DynamoDB)                    │
│       ├─ 3. onProjectOutcomeSet('PENDING') → stage SUBMITTED + APN         │
│       ├─ 4. Notify all org members via SQS (non-blocking)                  │
│       └─ 5. Write audit log (non-blocking)                                 │
│                                                                             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                                             │
│  Weeks/months later — award decision received:                             │
│                                                                             │
│  [Set Outcome] button (existing ProjectOutcomeCard)                        │
│  → WON: contract #, value, award date                                      │
│  → LOST: loss reason, winning contractor                                   │
│  → NO_BID / WITHDRAWN                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Submission record | DynamoDB (single-table) | Queryable by opportunity; tracks full submission history |
| Readiness validation | Server-side re-validation on submit | Prevents race conditions; client checklist is UI-only |
| Stage transition | `onProjectOutcomeSet('PENDING')` directly | Reuses existing stage + APN trigger logic; no new ProjectOutcome record |
| Notification | Existing SQS notification queue | Consistent with WIN/LOSS notification pattern |
| Required documents | `TECHNICAL_PROPOSAL` + `COST_PROPOSAL` | Minimum viable proposal; configurable per org in future |

---

## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

**File:** `packages/core/src/schemas/proposal-submission.ts`

```typescript
import { z } from 'zod';

// ─── Submission Status ────────────────────────────────────────────────────────

export const ProposalSubmissionStatusSchema = z.enum([
  'SUBMITTED',    // Successfully submitted to the agency
  'WITHDRAWN',    // Submission was withdrawn after submission
]);
export type ProposalSubmissionStatus = z.infer<typeof ProposalSubmissionStatusSchema>;

// ─── Submission Method ────────────────────────────────────────────────────────

export const SubmissionMethodSchema = z.enum([
  'PORTAL',           // Submitted via agency portal (SAM.gov, beta.SAM.gov, etc.)
  'EMAIL',            // Submitted via email to contracting officer
  'MANUAL',           // Submitted manually outside the system (tracked here for record)
  'HAND_DELIVERY',    // Physical hand delivery to contracting office
  'OTHER',            // Other method
]);
export type SubmissionMethod = z.infer<typeof SubmissionMethodSchema>;

// ─── Readiness Check Item ─────────────────────────────────────────────────────

export const ReadinessCheckItemSchema = z.object({
  id:          z.string().min(1),
  label:       z.string().min(1),
  description: z.string().optional(),
  passed:      z.boolean(),
  /** Detail message — explains what's missing or what's good */
  detail:      z.string().optional(),
  /** Blocking = submission cannot proceed if false. Non-blocking = warning only. */
  blocking:    z.boolean().default(true),
});
export type ReadinessCheckItem = z.infer<typeof ReadinessCheckItemSchema>;

// ─── Submission Readiness Response ───────────────────────────────────────────

export const SubmissionReadinessResponseSchema = z.object({
  ready:         z.boolean(),
  checks:        z.array(ReadinessCheckItemSchema),
  blockingFails: z.number().int().nonnegative(),
  warningFails:  z.number().int().nonnegative(),
});
export type SubmissionReadinessResponse = z.infer<typeof SubmissionReadinessResponseSchema>;

// ─── Proposal Submission Record (stored in DynamoDB) ─────────────────────────

export const ProposalSubmissionItemSchema = z.object({
  // Identity
  submissionId: z.string().uuid(),
  orgId:        z.string().min(1),
  projectId:    z.string().min(1),
  oppId:        z.string().min(1),

  // Submission details
  status:           ProposalSubmissionStatusSchema,
  submissionMethod: SubmissionMethodSchema,
  submittedAt:      z.string().datetime(),
  submittedBy:      z.string().min(1),   // userId
  submittedByName:  z.string().optional(),

  // Submission metadata — captured at time of submission
  submissionReference: z.string().optional(),  // Agency confirmation / tracking number
  submissionNotes:     z.string().max(2000).optional(),
  portalUrl:           z.string().url().optional(),  // Link to agency portal submission

  // Document snapshot — IDs of documents included in this submission
  documentIds: z.array(z.string()).default([]),

  // Deadline at time of submission (snapshot for historical record)
  deadlineIso: z.string().datetime().optional(),

  // Withdrawal info (if status = WITHDRAWN)
  withdrawnAt:      z.string().datetime().optional(),
  withdrawnBy:      z.string().optional(),
  withdrawalReason: z.string().max(1000).optional(),

  // Audit
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProposalSubmissionItem = z.infer<typeof ProposalSubmissionItemSchema>;

// ─── Submit Proposal DTO ──────────────────────────────────────────────────────

export const SubmitProposalSchema = z.object({
  orgId:               z.string().min(1),
  projectId:           z.string().min(1),
  oppId:               z.string().min(1),
  submissionMethod:    SubmissionMethodSchema,
  submissionReference: z.string().optional(),
  submissionNotes:     z.string().max(2000).optional(),
  portalUrl:           z.string().url().optional(),
  /** Explicitly include specific document IDs; if omitted, all non-deleted docs are included */
  documentIds:         z.array(z.string()).optional(),
  /** Skip non-blocking warnings (deadline passed, already submitted) */
  forceSubmit:         z.boolean().optional().default(false),
});
export type SubmitProposal = z.infer<typeof SubmitProposalSchema>;

// ─── Withdraw Submission DTO ──────────────────────────────────────────────────

export const WithdrawSubmissionSchema = z.object({
  orgId:            z.string().min(1),
  projectId:        z.string().min(1),
  oppId:            z.string().min(1),
  submissionId:     z.string().uuid(),
  withdrawalReason: z.string().max(1000).optional(),
});
export type WithdrawSubmission = z.infer<typeof WithdrawSubmissionSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const SubmitProposalResponseSchema = z.object({
  ok:         z.boolean(),
  submission: ProposalSubmissionItemSchema,
});
export type SubmitProposalResponse = z.infer<typeof SubmitProposalResponseSchema>;

export const ProposalSubmissionHistoryResponseSchema = z.object({
  items: z.array(ProposalSubmissionItemSchema),
  count: z.number(),
});
export type ProposalSubmissionHistoryResponse = z.infer<typeof ProposalSubmissionHistoryResponseSchema>;
```

**Export from** `packages/core/src/schemas/index.ts`:
```typescript
export * from './proposal-submission';
```

---

## 4. DynamoDB Design <!-- ⏳ PENDING -->

### PK Constants

**File:** `apps/functions/src/constants/proposal-submission.ts`

```typescript
export const PROPOSAL_SUBMISSION_PK = 'PROPOSAL_SUBMISSION' as const;
```

### Access Pattern Table

| Entity | PK | SK | Notes |
|---|---|---|---|
| Proposal Submission | `PROPOSAL_SUBMISSION` | `{orgId}#{projectId}#{oppId}#{submissionId}` | One record per submission attempt |

### SK Builder Functions

```typescript
export const buildSubmissionSk = (
  orgId: string,
  projectId: string,
  oppId: string,
  submissionId: string,
): string => `${orgId}#${projectId}#${oppId}#${submissionId}`;

export const buildSubmissionSkPrefix = (
  orgId: string,
  projectId: string,
  oppId: string,
): string => `${orgId}#${projectId}#${oppId}#`;
```

---

## 5. Backend — Lambda Handlers <!-- ⏳ PENDING -->

### File Structure

```
apps/functions/src/
├── constants/
│   └── proposal-submission.ts
├── helpers/
│   └── proposal-submission.ts          ← readiness validation + DynamoDB helpers
├── handlers/
│   └── proposal-submission/
│       ├── get-submission-readiness.ts  ← GET /proposal-submission/readiness
│       ├── submit-proposal.ts           ← POST /proposal-submission/submit
│       ├── get-submission-history.ts    ← GET /proposal-submission/history
│       └── withdraw-submission.ts       ← POST /proposal-submission/withdraw
```

---

### `apps/functions/src/helpers/proposal-submission.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { createItem, putItem, queryBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { getOpportunity } from '@/helpers/opportunity';
import { PROPOSAL_SUBMISSION_PK } from '@/constants/proposal-submission';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { docClient } from '@/helpers/db';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  ProposalSubmissionItem,
  SubmitProposal,
  ReadinessCheckItem,
  SubmissionReadinessResponse,
} from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildSubmissionSk = (
  orgId: string,
  projectId: string,
  oppId: string,
  submissionId: string,
): string => `${orgId}#${projectId}#${oppId}#${submissionId}`;

export const buildSubmissionSkPrefix = (
  orgId: string,
  projectId: string,
  oppId: string,
): string => `${orgId}#${projectId}#${oppId}#`;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Load all questions for an opportunity */
const listQuestionsForOpportunity = async (
  projectId: string,
  oppId: string,
): Promise<Array<{ questionId: string }>> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: {
        ':pk': QUESTION_PK,
        ':prefix': `${projectId}#`,
      },
      // Filter to this opportunity only
      FilterExpression: 'opportunityId = :oppId',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#oppId': 'opportunityId' },
      ExpressionAttributeValues: {
        ':pk': QUESTION_PK,
        ':prefix': `${projectId}#`,
        ':oppId': oppId,
      },
    }),
  );
  return (res.Items ?? []) as Array<{ questionId: string }>;
};

/** Load all answers for a project+opportunity */
const listAnswersForOpportunity = async (
  projectId: string,
  oppId: string,
): Promise<Array<{ questionId: string; text: string; status: string }>> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: {
        ':pk': ANSWER_PK,
        ':prefix': `${projectId}#`,
      },
      FilterExpression: 'opportunityId = :oppId',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#oppId': 'opportunityId' },
      ExpressionAttributeValues: {
        ':pk': ANSWER_PK,
        ':prefix': `${projectId}#`,
        ':oppId': oppId,
      },
    }),
  );
  return (res.Items ?? []) as Array<{ questionId: string; text: string; status: string }>;
};

// ─── Readiness Validation ─────────────────────────────────────────────────────

/**
 * Checks whether the proposal is ready to submit.
 *
 * From the proposal creator's perspective:
 *   BLOCKING (must fix before submitting):
 *     1. Opportunity is in PURSUING stage (GO decision made, actively working)
 *     2. Questions exist for this opportunity
 *     3. All questions have answers (no unanswered questions)
 *     4. All answers are APPROVED (not DRAFT — team has reviewed)
 *     5. Required documents present (Technical Proposal + Cost Proposal)
 *     6. No documents still generating (AI must finish)
 *     7. No documents in FAILED state (must regenerate or delete)
 *     8. All documents approved (signatureStatus = FULLY_SIGNED or NOT_REQUIRED)
 *
 *   WARNING (can submit anyway, but should review):
 *     9. Submission deadline not passed
 *    10. Not already submitted (allows re-submission for amendments)
 */
export const checkSubmissionReadiness = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  deadlineIso?: string | null;
  currentStage?: string | null;
}): Promise<SubmissionReadinessResponse> => {
  const { orgId, projectId, oppId, deadlineIso, currentStage } = args;
  const checks: ReadinessCheckItem[] = [];

  // ── BLOCKING 1: Opportunity must be in PURSUING stage ──
  // Only opportunities with a GO decision (PURSUING) should be submitted.
  // IDENTIFIED and QUALIFYING mean the team hasn't committed to pursuing yet.
  const isPursuing = currentStage === 'PURSUING';
  checks.push({
    id: 'opportunity_stage',
    label: 'Opportunity approved for pursuit',
    description: 'The opportunity must be in PURSUING stage (GO decision made) before submitting.',
    passed: isPursuing,
    detail: isPursuing
      ? 'Opportunity is in PURSUING stage — ready to submit'
      : currentStage === 'IDENTIFIED' || currentStage === 'QUALIFYING'
        ? `Opportunity is in ${currentStage} stage. Complete the Executive Brief and make a GO decision first.`
        : currentStage === 'SUBMITTED'
          ? 'Proposal already submitted — use re-submission if needed'
          : `Current stage: ${currentStage ?? 'unknown'}`,
    blocking: true,
  });

  // ── BLOCKING 2: Questions exist ──
  const questions = await listQuestionsForOpportunity(projectId, oppId);
  const hasQuestions = questions.length > 0;
  checks.push({
    id: 'questions_exist',
    label: 'RFP questions extracted',
    description: 'Questions must be extracted from the solicitation documents before submitting.',
    passed: hasQuestions,
    detail: hasQuestions
      ? `${questions.length} question(s) extracted`
      : 'No questions found. Upload solicitation documents and run question extraction first.',
    blocking: true,
  });

  // ── BLOCKING 3 & 4: All questions answered + all answers approved ──
  if (hasQuestions) {
    const answers = await listAnswersForOpportunity(projectId, oppId);
    const answeredQuestionIds = new Set(answers.filter((a) => a.text?.trim()).map((a) => a.questionId));
    const unansweredCount = questions.filter((q) => !answeredQuestionIds.has(q.questionId)).length;

    checks.push({
      id: 'all_questions_answered',
      label: 'All questions answered',
      description: 'Every RFP question must have an answer before submitting.',
      passed: unansweredCount === 0,
      detail: unansweredCount === 0
        ? `All ${questions.length} questions answered`
        : `${unansweredCount} question(s) still unanswered — answer or generate answers first`,
      blocking: true,
    });

    const draftAnswers = answers.filter((a) => a.status === 'DRAFT' || !a.status);
    checks.push({
      id: 'all_answers_approved',
      label: 'All answers approved',
      description: 'All answers must be reviewed and approved (not left as DRAFT).',
      passed: draftAnswers.length === 0,
      detail: draftAnswers.length === 0
        ? 'All answers approved by the team'
        : `${draftAnswers.length} answer(s) still in DRAFT — review and approve in the Q&A section`,
      blocking: true,
    });
  } else {
    // If no questions, add placeholder checks as failed
    checks.push({
      id: 'all_questions_answered',
      label: 'All questions answered',
      passed: false,
      detail: 'No questions to answer — extract questions first',
      blocking: true,
    });
    checks.push({
      id: 'all_answers_approved',
      label: 'All answers approved',
      passed: false,
      detail: 'No answers to approve — extract questions and generate answers first',
      blocking: true,
    });
  }

  // Load all documents for this opportunity
  const { items: allDocs } = await listRFPDocumentsByProject({ projectId, opportunityId: oppId });
  const activeDocs = allDocs.filter((d) => !d.deletedAt);

  // ── BLOCKING 5: Required documents present ──
  const hasTechnical = activeDocs.some((d) => d.documentType === 'TECHNICAL_PROPOSAL');
  const hasCost = activeDocs.some((d) => d.documentType === 'COST_PROPOSAL');
  const missingDocs = [
    !hasTechnical && 'Technical Proposal',
    !hasCost && 'Cost Proposal',
  ].filter(Boolean);
  checks.push({
    id: 'required_documents',
    label: 'Required proposal documents present',
    description: 'Technical Proposal and Cost Proposal are required for submission.',
    passed: missingDocs.length === 0,
    detail: missingDocs.length === 0
      ? 'Technical Proposal and Cost Proposal found'
      : `Missing: ${missingDocs.join(', ')} — generate or upload these documents`,
    blocking: true,
  });

  // ── BLOCKING 6: No documents generating ──
  const generatingDocs = activeDocs.filter((d) => d.status === 'GENERATING');
  checks.push({
    id: 'no_generating',
    label: 'All AI generation complete',
    description: 'Wait for all AI document generation to finish before submitting.',
    passed: generatingDocs.length === 0,
    detail: generatingDocs.length === 0
      ? 'All documents are ready'
      : `Still generating: ${generatingDocs.map((d) => d.name).join(', ')}`,
    blocking: true,
  });

  // ── BLOCKING 7: No failed generation ──
  const failedDocs = activeDocs.filter((d) => d.status === 'FAILED');
  checks.push({
    id: 'no_failed_generation',
    label: 'No failed document generation',
    description: 'Regenerate or delete documents that failed to generate.',
    passed: failedDocs.length === 0,
    detail: failedDocs.length === 0
      ? 'All documents generated successfully'
      : `Failed: ${failedDocs.map((d) => d.name).join(', ')} — regenerate or delete these`,
    blocking: true,
  });

  // ── BLOCKING 8: All documents approved (signed or not required) ──
  const unapprovedDocs = activeDocs.filter(
    (d) => d.signatureStatus !== 'FULLY_SIGNED' && d.signatureStatus !== 'NOT_REQUIRED',
  );
  checks.push({
    id: 'documents_approved',
    label: 'All documents approved',
    description: 'All documents must be fully signed or marked as not requiring signature.',
    passed: unapprovedDocs.length === 0,
    detail: unapprovedDocs.length === 0
      ? `All ${activeDocs.length} document(s) approved`
      : `${unapprovedDocs.length} document(s) not yet approved: ${unapprovedDocs.map((d) => d.name).join(', ')}`,
    blocking: true,
  });

  // ── WARNING 9: Deadline ──
  if (deadlineIso) {
    const deadline = new Date(deadlineIso);
    const now = new Date();
    const deadlinePassed = now > deadline;
    const hoursLeft = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
    checks.push({
      id: 'deadline_check',
      label: 'Submission deadline',
      description: 'Submit before the response deadline.',
      passed: !deadlinePassed,
      detail: deadlinePassed
        ? `Deadline passed ${Math.abs(Math.round(hoursLeft))}h ago — late submission`
        : hoursLeft < 24
          ? `⚠️ Deadline in ${Math.round(hoursLeft)} hours — submit soon`
          : `Deadline: ${deadline.toLocaleDateString()}`,
      blocking: false,
    });
  }

  // ── WARNING 10: Not already submitted ──
  const existing = await queryBySkPrefix<ProposalSubmissionItem>(
    PROPOSAL_SUBMISSION_PK,
    buildSubmissionSkPrefix(orgId, projectId, oppId),
  );
  const activeSubmissions = existing.filter((s) => s.status === 'SUBMITTED');
  checks.push({
    id: 'not_already_submitted',
    label: 'Submission status',
    description: 'Track whether this opportunity has already been submitted.',
    passed: activeSubmissions.length === 0,
    detail: activeSubmissions.length === 0
      ? 'No prior submission found'
      : `Already submitted on ${new Date(activeSubmissions[0]!.submittedAt).toLocaleDateString()} — this will be a re-submission`,
    blocking: false,
  });

  const blockingFails = checks.filter((c) => c.blocking && !c.passed).length;
  const warningFails = checks.filter((c) => !c.blocking && !c.passed).length;

  return { ready: blockingFails === 0, checks, blockingFails, warningFails };
};

// ─── DynamoDB Helpers ─────────────────────────────────────────────────────────

export const createSubmissionRecord = async (
  dto: SubmitProposal,
  submittedBy: string,
  submittedByName: string | undefined,
  documentIds: string[],
  deadlineIso?: string | null,
): Promise<ProposalSubmissionItem> => {
  const submissionId = uuidv4();

  return createItem<ProposalSubmissionItem>(
    PROPOSAL_SUBMISSION_PK,
    buildSubmissionSk(dto.orgId, dto.projectId, dto.oppId, submissionId),
    {
      submissionId,
      orgId:               dto.orgId,
      projectId:           dto.projectId,
      oppId:               dto.oppId,
      status:              'SUBMITTED',
      submissionMethod:    dto.submissionMethod,
      submittedAt:         nowIso(),
      submittedBy,
      submittedByName,
      submissionReference: dto.submissionReference,
      submissionNotes:     dto.submissionNotes,
      portalUrl:           dto.portalUrl,
      documentIds,
      deadlineIso:         deadlineIso ?? undefined,
    },
  );
};

export const getSubmissionHistory = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<ProposalSubmissionItem[]> => {
  const items = await queryBySkPrefix<ProposalSubmissionItem>(
    PROPOSAL_SUBMISSION_PK,
    buildSubmissionSkPrefix(orgId, projectId, oppId),
  );
  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
};

export const withdrawSubmission = async (
  orgId: string,
  projectId: string,
  oppId: string,
  submissionId: string,
  withdrawnBy: string,
  withdrawalReason?: string,
): Promise<void> => {
  await putItem(
    PROPOSAL_SUBMISSION_PK,
    buildSubmissionSk(orgId, projectId, oppId, submissionId),
    { status: 'WITHDRAWN', withdrawnAt: nowIso(), withdrawnBy, withdrawalReason, updatedAt: nowIso() },
    true,
  );
};
```

---

### `apps/functions/src/handlers/proposal-submission/get-submission-readiness.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { checkSubmissionReadiness } from '@/helpers/proposal-submission';
import { getOpportunity } from '@/helpers/opportunity';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const opp = await getOpportunity({ orgId, projectId, oppId });
  const deadlineIso = (opp?.item?.responseDeadlineIso as string | undefined) ?? null;
  const currentStage = (opp?.item?.stage as string | undefined) ?? null;

  const readiness = await checkSubmissionReadiness({ orgId, projectId, oppId, deadlineIso, currentStage });
  return apiResponse(200, readiness);
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/proposal-submission/submit-proposal.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { checkSubmissionReadiness, createSubmissionRecord } from '@/helpers/proposal-submission';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { getOpportunity } from '@/helpers/opportunity';
import { onProjectOutcomeSet } from '@/helpers/opportunity-stage';
import { getOrgMembers } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { SubmitProposalSchema } from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = SubmitProposalSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId;

  // ── 1. Load opportunity (for deadline + title) ──
  const opp = await getOpportunity({ orgId: data.orgId, projectId: data.projectId, oppId: data.oppId });
  if (!opp) return apiResponse(404, { message: 'Opportunity not found' });
  const deadlineIso = (opp.item?.responseDeadlineIso as string | undefined) ?? null;

  // ── 2. Server-side readiness re-validation ──
  const readiness = await checkSubmissionReadiness({
    orgId: data.orgId, projectId: data.projectId, oppId: data.oppId, deadlineIso,
  });
  if (!readiness.ready && !data.forceSubmit) {
    return apiResponse(422, {
      message: 'Proposal is not ready for submission',
      checks: readiness.checks,
      blockingFails: readiness.blockingFails,
    });
  }

  // ── 3. Collect document IDs (snapshot of what was submitted) ──
  let documentIds = data.documentIds ?? [];
  if (documentIds.length === 0) {
    const { items: docs } = await listRFPDocumentsByProject({
      projectId: data.projectId,
      opportunityId: data.oppId,
    });
    documentIds = docs
      .filter((d) => !d.deletedAt && d.status !== 'GENERATING')
      .map((d) => d.documentId as string);
  }

  // ── 4. Create submission record ──
  const submission = await createSubmissionRecord(data, userId, userName, documentIds, deadlineIso);

  // ── 5. Trigger stage → SUBMITTED + APN registration (non-blocking) ──
  // NOTE: We call onProjectOutcomeSet directly — we do NOT create a ProjectOutcome record.
  // ProjectOutcome is only set when the award decision is known (WON/LOST/NO_BID/WITHDRAWN).
  onProjectOutcomeSet({
    orgId: data.orgId,
    projectId: data.projectId,
    oppId: data.oppId,
    outcomeStatus: 'PENDING',
    changedBy: userId,
  }).catch((err) =>
    console.warn('[submit-proposal] Stage transition failed (non-blocking):', (err as Error).message),
  );

  // ── 6. Notify all org members (non-blocking) ──
  getOrgMembers(data.orgId)
    .then((members) => {
      if (!members.length) return;
      return sendNotification(
        buildNotification(
          'PROPOSAL_SUBMITTED',
          '📤 Proposal Submitted',
          `Proposal for "${opp.item?.title ?? data.oppId}" has been submitted.`,
          {
            orgId: data.orgId,
            projectId: data.projectId,
            entityId: data.oppId,
            recipientUserIds: members.map((m) => m.userId),
            recipientEmails: members.map((m) => m.email),
            actorDisplayName: userName,
          },
        ),
      );
    })
    .catch((err) => console.warn('[submit-proposal] Notification failed:', (err as Error).message));

  // ── 7. Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(), timestamp: nowIso(), userId, userName,
      organizationId: data.orgId,
      action: 'PROPOSAL_SUBMITTED',
      resource: 'proposal',
      resourceId: submission.submissionId,
      changes: {
        after: {
          submissionMethod: data.submissionMethod,
          documentCount: documentIds.length,
          oppId: data.oppId,
          submissionReference: data.submissionReference,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[submit-proposal] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: 'PROPOSAL_SUBMITTED',
    resource: 'proposal',
    resourceId: submission.submissionId,
    orgId: data.orgId,
  });

  return apiResponse(200, { ok: true, submission });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/proposal-submission/get-submission-history.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getSubmissionHistory } from '@/helpers/proposal-submission';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const items = await getSubmissionHistory(orgId, projectId, oppId);
  return apiResponse(200, { items, count: items.length });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/proposal-submission/withdraw-submission.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { withdrawSubmission } from '@/helpers/proposal-submission';
import { WithdrawSubmissionSchema } from '@auto-rfp/core';
import {
  authContextMiddleware, httpErrorMiddleware,
  orgMembershipMiddleware, requirePermission, type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = WithdrawSubmissionSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId;

  await withdrawSubmission(data.orgId, data.projectId, data.oppId, data.submissionId, userId, data.withdrawalReason);

  setAuditContext(event, {
    action: 'PROPOSAL_SUBMITTED',
    resource: 'proposal',
    resourceId: data.submissionId,
    orgId: data.orgId,
  });

  writeAuditLog(
    {
      logId: uuidv4(), timestamp: nowIso(), userId, userName,
      organizationId: data.orgId,
      action: 'PROPOSAL_SUBMITTED',
      resource: 'proposal',
      resourceId: data.submissionId,
      changes: { before: { status: 'SUBMITTED' }, after: { status: 'WITHDRAWN', withdrawalReason: data.withdrawalReason } },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[withdraw-submission] Audit log failed:', (err as Error).message));

  return apiResponse(200, { ok: true });
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

## 6. REST API Routes <!-- ⏳ PENDING -->

### `packages/infra/api/routes/proposal-submission.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const proposalSubmissionDomain = (): DomainRoutes => ({
  basePath: 'proposal-submission',
  routes: [
    { method: 'GET',  path: 'readiness', entry: lambdaEntry('proposal-submission/get-submission-readiness.ts') },
    { method: 'POST', path: 'submit',    entry: lambdaEntry('proposal-submission/submit-proposal.ts') },
    { method: 'GET',  path: 'history',   entry: lambdaEntry('proposal-submission/get-submission-history.ts') },
    { method: 'POST', path: 'withdraw',  entry: lambdaEntry('proposal-submission/withdraw-submission.ts') },
  ],
});
```

### Registration in `packages/infra/api/api-orchestrator-stack.ts`

```typescript
import { proposalSubmissionDomain } from './routes/proposal-submission.routes';
// allDomains: proposalSubmissionDomain(),
// domainStackNames: 'ProposalSubmissionRoutes',
```

### Endpoint Summary

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/proposal-submission/readiness?orgId=&projectId=&oppId=` | `proposal:read` | Get readiness checklist (8 checks) |
| `POST` | `/proposal-submission/submit` | `proposal:create` | Submit the proposal |
| `GET` | `/proposal-submission/history?orgId=&projectId=&oppId=` | `proposal:read` | Get submission history |
| `POST` | `/proposal-submission/withdraw` | `proposal:edit` | Withdraw a submission |

---

## 7. Frontend — Hooks & Components <!-- ⏳ PENDING -->

### File Structure

```
apps/web/features/proposal-submission/
├── components/
│   ├── SubmissionChecklist.tsx      ← 8-check readiness card with icons
│   ├── SubmitProposalButton.tsx     ← Gated submit button + confirmation dialog
│   ├── SubmissionHistoryCard.tsx    ← Past submissions with withdraw button
│   └── WithdrawSubmissionButton.tsx ← Withdraw dialog
├── hooks/
│   ├── useSubmissionReadiness.ts    ← SWR, polls every 15s (detects generation completion)
│   ├── useSubmitProposal.ts         ← POST mutation
│   ├── useSubmissionHistory.ts      ← SWR
│   └── useWithdrawSubmission.ts     ← POST mutation
└── index.ts
```

---

### `hooks/useSubmissionReadiness.ts`

```typescript
'use client';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { SubmissionReadinessResponse } from '@auto-rfp/core';

export const useSubmissionReadiness = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url = orgId && projectId && oppId
    ? buildApiUrl('proposal-submission/readiness', { orgId, projectId, oppId })
    : null;

  const { data, error, isLoading, mutate } = useSWR<SubmissionReadinessResponse>(
    url, apiFetcher,
    { refreshInterval: 15_000 }, // auto-refresh while AI is generating
  );

  return {
    readiness: data ?? null,
    isReady: data?.ready ?? false,
    checks: data?.checks ?? [],
    blockingFails: data?.blockingFails ?? 0,
    warningFails: data?.warningFails ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
};
```

---

### `hooks/useSubmitProposal.ts`

```typescript
'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { SubmitProposal, SubmitProposalResponse } from '@auto-rfp/core';

export const useSubmitProposal = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (dto: SubmitProposal): Promise<SubmitProposalResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<SubmitProposalResponse>(buildApiUrl('proposal-submission/submit'), 'POST', dto);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit proposal');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { submit, isLoading, error };
};
```

---

### `hooks/useSubmissionHistory.ts`

```typescript
'use client';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ProposalSubmissionHistoryResponse } from '@auto-rfp/core';

export const useSubmissionHistory = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url = orgId && projectId && oppId
    ? buildApiUrl('proposal-submission/history', { orgId, projectId, oppId })
    : null;

  const { data, error, isLoading, mutate } = useSWR<ProposalSubmissionHistoryResponse>(
    url, apiFetcher, { revalidateOnFocus: false },
  );

  return {
    submissions: data?.items ?? [],
    count: data?.count ?? 0,
    isLoading, error, refresh: mutate,
  };
};
```

---

### `hooks/useWithdrawSubmission.ts`

```typescript
'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { WithdrawSubmission } from '@auto-rfp/core';

export const useWithdrawSubmission = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async (dto: WithdrawSubmission): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiMutate(buildApiUrl('proposal-submission/withdraw'), 'POST', dto);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to withdraw submission');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { withdraw, isLoading, error };
};
```

---

### `components/SubmissionChecklist.tsx`

```typescript
'use client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { useSubmissionReadiness } from '../hooks/useSubmissionReadiness';
import type { ReadinessCheckItem } from '@auto-rfp/core';

interface SubmissionChecklistProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

function CheckRow({ check }: { check: ReadinessCheckItem }) {
  const icon = check.passed
    ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
    : check.blocking
      ? <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;

  return (
    <div className="flex items-start gap-3 py-2.5">
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${
          check.passed ? 'text-foreground' : check.blocking ? 'text-destructive' : 'text-amber-700'
        }`}>
          {check.label}
        </p>
        {check.detail && (
          <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
        )}
      </div>
      {!check.blocking && !check.passed && (
        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 shrink-0">
          Warning
        </Badge>
      )}
    </div>
  );
}

export const SubmissionChecklist = ({ orgId, projectId, oppId }: SubmissionChecklistProps) => {
  const { readiness, isReady, checks, blockingFails, isLoading } = useSubmissionReadiness(orgId, projectId, oppId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!readiness) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {isReady
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              : <Clock className="h-4 w-4 text-amber-500" />}
            Submission Readiness
          </CardTitle>
          <Badge variant={isReady ? 'default' : 'secondary'}>
            {isReady ? 'Ready to Submit' : `${blockingFails} issue${blockingFails !== 1 ? 's' : ''} to resolve`}
          </Badge>
        </div>
        <CardDescription>
          Complete all required steps before submitting your proposal to the agency.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {checks.map((check) => <CheckRow key={check.id} check={check} />)}
        </div>
      </CardContent>
    </Card>
  );
};
```

---

### `components/SubmitProposalButton.tsx`

```typescript
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SubmitProposalSchema } from '@auto-rfp/core';
import type { SubmitProposal } from '@auto-rfp/core';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Send, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useSubmitProposal } from '../hooks/useSubmitProposal';
import { useSubmissionReadiness } from '../hooks/useSubmissionReadiness';

interface SubmitProposalButtonProps {
  orgId: string;
  projectId: string;
  oppId: string;
  onSuccess?: () => void;
}

type FormValues = z.input<typeof SubmitProposalSchema>;

const SUBMISSION_METHODS = [
  { value: 'PORTAL',        label: 'Agency Portal (SAM.gov, beta.SAM.gov, etc.)' },
  { value: 'EMAIL',         label: 'Email to Contracting Officer' },
  { value: 'MANUAL',        label: 'Manual / Other System' },
  { value: 'HAND_DELIVERY', label: 'Hand Delivery' },
  { value: 'OTHER',         label: 'Other' },
] as const;

export const SubmitProposalButton = ({ orgId, projectId, oppId, onSuccess }: SubmitProposalButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const { submit, isLoading } = useSubmitProposal();
  const { isReady, blockingFails, warningFails, isLoading: isCheckingReadiness } = useSubmissionReadiness(orgId, projectId, oppId);
  const { toast } = useToast();

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(SubmitProposalSchema),
    defaultValues: { orgId, projectId, oppId, submissionMethod: 'PORTAL', forceSubmit: false },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await submit(values as SubmitProposal);
    if (result) {
      toast({ title: '📤 Proposal Submitted', description: 'Your proposal has been successfully submitted to the agency.' });
      reset();
      setShowDialog(false);
      onSuccess?.();
    } else {
      toast({ title: 'Submission Failed', description: 'Could not submit. Check the readiness checklist.', variant: 'destructive' });
    }
  };

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        disabled={!isReady || isCheckingReadiness}
        className="gap-2"
        size="lg"
      >
        <Send className="h-4 w-4" />
        Submit Proposal
        {blockingFails > 0 && (
          <Badge variant="secondary" className="ml-1 text-xs">
            {blockingFails} issue{blockingFails !== 1 ? 's' : ''}
          </Badge>
        )}
      </Button>

      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) reset(); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Submit Proposal to Agency
            </DialogTitle>
            <DialogDescription>
              Record how and where you submitted this proposal. This marks the opportunity as Submitted.
            </DialogDescription>
          </DialogHeader>

          {warningFails > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {warningFails} non-blocking warning{warningFails !== 1 ? 's' : ''} — review the checklist before submitting.
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input type="hidden" {...register('orgId')} />
            <input type="hidden" {...register('projectId')} />
            <input type="hidden" {...register('oppId')} />

            <div className="space-y-1.5">
              <Label>Submission Method</Label>
              <Select defaultValue="PORTAL" onValueChange={(v) => setValue('submissionMethod', v as SubmitProposal['submissionMethod'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBMISSION_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Confirmation / Tracking Number
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </Label>
              <Input {...register('submissionReference')} placeholder="e.g. SAM-2025-001234 or email thread ID" />
            </div>

            <div className="space-y-1.5">
              <Label>
                Portal URL
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </Label>
              <Input {...register('portalUrl')} type="url" placeholder="https://sam.gov/opp/..." />
              {errors.portalUrl && <p className="text-xs text-destructive">{errors.portalUrl.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Notes
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </Label>
              <Textarea {...register('submissionNotes')} placeholder="Any notes about this submission..." rows={3} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} className="gap-2">
                {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : <><Send className="h-4 w-4" />Confirm Submission</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
```

---

### `components/SubmissionHistoryCard.tsx`

```typescript
'use client';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, FileText, Send, Undo2 } from 'lucide-react';
import { useSubmissionHistory } from '../hooks/useSubmissionHistory';
import { WithdrawSubmissionButton } from './WithdrawSubmissionButton';
import type { ProposalSubmissionItem } from '@auto-rfp/core';

interface SubmissionHistoryCardProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

const STATUS_CONFIG = {
  SUBMITTED: { label: 'Submitted', variant: 'default' as const },
  WITHDRAWN: { label: 'Withdrawn', variant: 'secondary' as const },
};

const METHOD_LABELS: Record<ProposalSubmissionItem['submissionMethod'], string> = {
  PORTAL: 'Agency Portal', EMAIL: 'Email', MANUAL: 'Manual',
  HAND_DELIVERY: 'Hand Delivery', OTHER: 'Other',
};

export const SubmissionHistoryCard = ({ orgId, projectId, oppId }: SubmissionHistoryCardProps) => {
  const { submissions, count, isLoading, refresh } = useSubmissionHistory(orgId, projectId, oppId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2"><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><Skeleton className="h-16 w-full" /></CardContent>
      </Card>
    );
  }

  if (count === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Send className="h-4 w-4" />
          Submission History
        </CardTitle>
        <Badge variant="outline" className="text-xs">{count} submission{count !== 1 ? 's' : ''}</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {submissions.map((sub) => {
            const cfg = STATUS_CONFIG[sub.status];
            return (
              <div key={sub.submissionId} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                    <span className="text-xs text-muted-foreground">{METHOD_LABELS[sub.submissionMethod]}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(sub.submittedAt), 'MMM d, yyyy HH:mm')}
                    </span>
                    {sub.submittedByName && (
                      <span className="text-xs text-muted-foreground">by {sub.submittedByName}</span>
                    )}
                  </div>
                  {sub.submissionReference && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Ref: <code className="font-mono">{sub.submissionReference}</code>
                    </p>
                  )}
                  {sub.portalUrl && (
                    <a href={sub.portalUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />View in Portal
                    </a>
                  )}
                  {sub.submissionNotes && (
                    <p className="text-xs text-muted-foreground italic">{sub.submissionNotes}</p>
                  )}
                  {sub.status === 'WITHDRAWN' && sub.withdrawalReason && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Undo2 className="h-3 w-3" />Withdrawn: {sub.withdrawalReason}
                    </p>
                  )}
                </div>
                {sub.status === 'SUBMITTED' && (
                  <WithdrawSubmissionButton
                    orgId={orgId} projectId={projectId} oppId={oppId}
                    submissionId={sub.submissionId} onSuccess={refresh}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
```

---

### `components/WithdrawSubmissionButton.tsx`

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
import { Loader2, Undo2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useWithdrawSubmission } from '../hooks/useWithdrawSubmission';

interface WithdrawSubmissionButtonProps {
  orgId: string; projectId: string; oppId: string;
  submissionId: string; onSuccess?: () => void;
}

export const WithdrawSubmissionButton = ({ orgId, projectId, oppId, submissionId, onSuccess }: WithdrawSubmissionButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [reason, setReason] = useState('');
  const { withdraw, isLoading } = useWithdrawSubmission();
  const { toast } = useToast();

  const handleWithdraw = async () => {
    const ok = await withdraw({ orgId, projectId, oppId, submissionId, withdrawalReason: reason || undefined });
    if (ok) {
      toast({ title: 'Submission Withdrawn', description: 'The proposal submission has been withdrawn.' });
      setShowDialog(false);
      setReason('');
      onSuccess?.();
    } else {
      toast({ title: 'Withdrawal Failed', variant: 'destructive', description: 'Could not withdraw the submission.' });
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm"
        className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive shrink-0"
        onClick={() => setShowDialog(true)}>
        <Undo2 className="h-3 w-3" />Withdraw
      </Button>
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Withdraw Submission</DialogTitle>
            <DialogDescription>
              Mark this submission as withdrawn. The opportunity stage will not change automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Solicitation cancelled, team capacity, scope change..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isLoading}>Cancel</Button>
            <Button variant="destructive" onClick={handleWithdraw} disabled={isLoading} className="gap-2">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
```

---

### `index.ts`

```typescript
export { SubmissionChecklist } from './components/SubmissionChecklist';
export { SubmitProposalButton } from './components/SubmitProposalButton';
export { SubmissionHistoryCard } from './components/SubmissionHistoryCard';
export { WithdrawSubmissionButton } from './components/WithdrawSubmissionButton';
export { useSubmissionReadiness } from './hooks/useSubmissionReadiness';
export { useSubmitProposal } from './hooks/useSubmitProposal';
export { useSubmissionHistory } from './hooks/useSubmissionHistory';
export { useWithdrawSubmission } from './hooks/useWithdrawSubmission';
```

---

## 8. Wire into Existing Pages <!-- ⏳ PENDING -->

### `apps/web/components/opportunities/OpportunityView.tsx`

The opportunity detail page is the proposal creator's command center. Add the submission section **before** `ProjectOutcomeCard` (submission happens before the award result):

```typescript
import {
  SubmissionChecklist,
  SubmitProposalButton,
  SubmissionHistoryCard,
} from '@/features/proposal-submission';

// In OpportunityContent, BEFORE <ProjectOutcomeCard>:

{/* Submission Readiness + Submit Button */}
<SubmissionChecklist orgId={orgId} projectId={projectId} oppId={oppId} />
<div className="flex justify-end">
  <PermissionWrapper requiredPermission="proposal:create">
    <SubmitProposalButton
      orgId={orgId}
      projectId={projectId}
      oppId={oppId}
      onSuccess={() => {
        // Refresh the page to show updated stage badge
      }}
    />
  </PermissionWrapper>
</div>
<SubmissionHistoryCard orgId={orgId} projectId={projectId} oppId={oppId} />

{/* Award Result — set AFTER agency announces decision */}
<ProjectOutcomeCard projectId={projectId} orgId={orgId} opportunityId={oppId} />
```

### `apps/web/components/project-outcome/SetProjectOutcomeDialog.tsx`

Remove `PENDING` from the status dropdown — proposal creators now use the "Submit Proposal" button:

```typescript
// REMOVE this SelectItem:
// <SelectItem value="PENDING">Pending</SelectItem>

// The dropdown should only show terminal outcomes:
<SelectItem value="WON">Won</SelectItem>
<SelectItem value="LOST">Lost</SelectItem>
<SelectItem value="NO_BID">No Bid</SelectItem>
<SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
```

---

## 9. Permissions & RBAC <!-- ⏳ PENDING -->

No new permissions needed — reuse existing:

| Permission | Used for |
|---|---|
| `proposal:read` | View readiness checklist + submission history |
| `proposal:create` | Submit proposal |
| `proposal:edit` | Withdraw submission |

---

## 10. CDK Stack Updates <!-- ⏳ PENDING -->

### Log Groups (add to `api-orchestrator-stack.ts`)

```typescript
const proposalSubmissionHandlers = [
  'get-submission-readiness',
  'submit-proposal',
  'get-submission-history',
  'withdraw-submission',
];

for (const handlerName of proposalSubmissionHandlers) {
  new logs.LogGroup(this, `ProposalSubmissionLogs-${handlerName}-${stage}`, {
    logGroupName: `/aws/lambda/auto-rfp-proposal-submission-${handlerName}-${stage}`,
    retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
}
```

---

## 11. Implementation Tickets <!-- ⏳ PENDING -->

### PS-1 · Core Schemas & Constants (30 min) <!-- ⏳ PENDING -->

- `packages/core/src/schemas/proposal-submission.ts` ← new
- `packages/core/src/schemas/index.ts` ← add export
- `apps/functions/src/constants/proposal-submission.ts` ← new

### PS-2 · Backend Helper (1.5 h) <!-- ⏳ PENDING -->

- `apps/functions/src/helpers/proposal-submission.ts`
- 8 readiness checks, DynamoDB helpers, SK builders

### PS-3 · Lambda Handlers (1 h) <!-- ⏳ PENDING -->

- 4 handlers in `apps/functions/src/handlers/proposal-submission/`
- `submit-proposal` calls `onProjectOutcomeSet('PENDING')` directly — NOT `setProjectOutcome`

### PS-4 · CDK Routes (30 min) <!-- ⏳ PENDING -->

- `packages/infra/api/routes/proposal-submission.routes.ts`
- Register in `api-orchestrator-stack.ts` + log groups

### PS-5 · Frontend Feature Module (2 h) <!-- ⏳ PENDING -->

- 4 hooks + 4 components + barrel export

### PS-6 · Wire into OpportunityView + Fix SetProjectOutcomeDialog (30 min) <!-- ⏳ PENDING -->

- Add `SubmissionChecklist` + `SubmitProposalButton` + `SubmissionHistoryCard` BEFORE `ProjectOutcomeCard`
- Remove `PENDING` from `SetProjectOutcomeDialog` dropdown

### PS-7 · Tests (1 h) <!-- ⏳ PENDING -->

- Schema tests, helper tests, handler tests

---

## 12. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

**Proposal Creator Experience:**
- [ ] Readiness checklist visible on opportunity detail page, auto-refreshes every 15s while AI generates
- [ ] Submit button disabled until all 8 blocking checks pass
- [ ] Submit button shows warning count when non-blocking checks fail
- [ ] Submission dialog captures: method, confirmation number, portal URL, notes
- [ ] After submit: opportunity stage badge updates to `SUBMITTED`
- [ ] After submit: APN registration triggered automatically (non-blocking)
- [ ] After submit: all org members receive `PROPOSAL_SUBMITTED` notification
- [ ] Submission history card shows past submissions with method, date, reference number
- [ ] Withdraw button available for active submissions

**Readiness Checks (8 blocking + 2 warnings):**
- [ ] Check 1 (blocking): Opportunity is in `PURSUING` stage — shows helpful message for IDENTIFIED/QUALIFYING
- [ ] Check 2 (blocking): Questions extracted from solicitation documents
- [ ] Check 3 (blocking): All questions have answers (no unanswered questions)
- [ ] Check 4 (blocking): All answers are `APPROVED` (not `DRAFT`)
- [ ] Check 5 (blocking): Technical Proposal and Cost Proposal documents present
- [ ] Check 6 (blocking): No documents still generating
- [ ] Check 7 (blocking): No documents in FAILED state
- [ ] Check 8 (blocking): All documents approved (FULLY_SIGNED or NOT_REQUIRED)
- [ ] Check 9 (warning): Submission deadline not passed
- [ ] Check 10 (warning): Not already submitted (allows re-submission for amendments)

**System Correctness:**
- [ ] `submit-proposal` calls `onProjectOutcomeSet('PENDING')` — no new `ProjectOutcome` DB record created
- [ ] `SetProjectOutcomeDialog` no longer shows `PENDING` — only WON/LOST/NO_BID/WITHDRAWN
- [ ] `ProjectOutcomeCard` still works for recording award results after agency decision
- [ ] Server-side re-validation prevents submission when blocking checks fail (422 response)
- [ ] Audit log written with `PROPOSAL_SUBMITTED` action
- [ ] TypeScript compiles with no errors across all packages

---

## 13. Summary of New Files <!-- ⏳ PENDING -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/proposal-submission.ts` | Zod schemas | ⏳ |
| `apps/functions/src/constants/proposal-submission.ts` | PK constant | ⏳ |
| `apps/functions/src/helpers/proposal-submission.ts` | Readiness validation + DynamoDB helpers | ⏳ |
| `apps/functions/src/handlers/proposal-submission/get-submission-readiness.ts` | GET readiness | ⏳ |
| `apps/functions/src/handlers/proposal-submission/submit-proposal.ts` | POST submit | ⏳ |
| `apps/functions/src/handlers/proposal-submission/get-submission-history.ts` | GET history | ⏳ |
| `apps/functions/src/handlers/proposal-submission/withdraw-submission.ts` | POST withdraw | ⏳ |
| `packages/infra/api/routes/proposal-submission.routes.ts` | CDK routes | ⏳ |
| `apps/web/features/proposal-submission/hooks/useSubmissionReadiness.ts` | SWR hook | ⏳ |
| `apps/web/features/proposal-submission/hooks/useSubmitProposal.ts` | Mutation hook | ⏳ |
| `apps/web/features/proposal-submission/hooks/useSubmissionHistory.ts` | SWR hook | ⏳ |
| `apps/web/features/proposal-submission/hooks/useWithdrawSubmission.ts` | Mutation hook | ⏳ |
| `apps/web/features/proposal-submission/components/SubmissionChecklist.tsx` | Readiness card | ⏳ |
| `apps/web/features/proposal-submission/components/SubmitProposalButton.tsx` | Submit button + dialog | ⏳ |
| `apps/web/features/proposal-submission/components/SubmissionHistoryCard.tsx` | History card | ⏳ |
| `apps/web/features/proposal-submission/components/WithdrawSubmissionButton.tsx` | Withdraw dialog | ⏳ |
| `apps/web/features/proposal-submission/index.ts` | Barrel export | ⏳ |
| `packages/core/src/schemas/proposal-submission.test.ts` | Schema tests | ⏳ |
| `apps/functions/src/helpers/proposal-submission.test.ts` | Helper tests | ⏳ |
| `apps/functions/src/handlers/proposal-submission/submit-proposal.test.ts` | Handler tests | ⏳ |

**Modified Files:**

| File | Change | Status |
|---|---|---|
| `packages/core/src/schemas/index.ts` | Add `export * from './proposal-submission'` | ⏳ |
| `packages/infra/api/api-orchestrator-stack.ts` | Register domain + log groups | ⏳ |
| `apps/web/components/opportunities/OpportunityView.tsx` | Add submission section BEFORE `ProjectOutcomeCard` | ⏳ |
| `apps/web/components/project-outcome/SetProjectOutcomeDialog.tsx` | Remove `PENDING` from dropdown | ⏳ |
