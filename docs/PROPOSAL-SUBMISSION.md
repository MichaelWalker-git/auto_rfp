# Proposal Submission Flow

## Overview

The proposal submission feature allows users to record and track RFP proposal submissions. It provides compliance checking, document selection, delivery tracking, and email draft generation.

## User Flow

### 1. Navigate to Submit Page

From the Opportunity view → "Submit Proposal" button → Opens full-page submission form at:
```
/organizations/{orgId}/projects/{projectId}/opportunities/{oppId}/submit
```

### 2. Review Compliance

The page shows a compliance summary with pass rate and blocking check count. If blocking checks exist (that haven't been ignored), the Submit button is disabled.

**Ignoring checks**: Admins can ignore blocking checks from the Compliance Report section on the Opportunity page. Ignored checks are stored on the opportunity entity (`ignoredComplianceCheckIds` field) and excluded from all readiness calculations — both frontend and backend.

### 3. Select Documents

All non-deleted, non-generating RFP documents are listed with checkboxes. Users can select/deselect individual documents or use "Select all". Selected document IDs are included in the submission record.

### 4. Fill Delivery Details

- **Submission Method**: PORTAL, EMAIL, MANUAL, HAND_DELIVERY, OTHER
- **Confirmation/Tracking Number**: Optional reference ID
- **Portal URL**: Optional link to the submission portal
- **Notes**: Optional free-text notes

### 5. Review Email Draft

A live-updating email template is shown with:
- **Subject**: `Proposal Submission — {Solicitation Number}: {Opportunity Title}`
- **Body**: Professional email listing all selected documents
- **Actions**: "Copy to Clipboard" and "Open in Email Client" (mailto: link)

The email draft updates in real-time as documents are selected/deselected.

### 6. Submit

Clicking "Submit Proposal":
1. Sends POST to `/proposal-submission/submit` with form data + selected document IDs
2. Backend re-validates readiness (respecting ignored checks)
3. Creates a `ProposalSubmissionItem` record in DynamoDB
4. Transitions opportunity stage to SUBMITTED (via `onProjectOutcomeSet`)
5. Sends notification to all org members
6. Writes audit log
7. Returns success → redirects back to opportunity page

## Architecture

### Frontend

| Component | File | Purpose |
|-----------|------|---------|
| Submit Page | `app/.../opportunities/[oppId]/submit/page.tsx` | Full-page submission form |
| Submit Button | `features/proposal-submission/components/SubmitProposalButton.tsx` | Navigation button on opportunity view |
| Compliance Report | `features/proposal-submission/components/ComplianceReport.tsx` | Detailed check UI with ignore |
| Submission History | `features/proposal-submission/components/SubmissionHistoryCard.tsx` | Past submissions list |

### Hooks

| Hook | Endpoint | Purpose |
|------|----------|---------|
| `useSubmitProposal` | POST `/proposal-submission/submit` | Submit proposal |
| `useSubmissionReadiness` | GET `/proposal-submission/readiness` | Check if ready (15s poll) |
| `useComplianceReport` | GET `/proposal-submission/compliance` | Full report (30s poll) |
| `useSubmissionHistory` | GET `/proposal-submission/history` | Past submissions |
| `useIgnoredChecks` | PUT `/opportunity/update-opportunity` | Toggle ignored checks |

### Backend

| Handler | Method | Path | Purpose |
|---------|--------|------|---------|
| `submit-proposal.ts` | POST | `/submit` | Record submission, transition stage |
| `get-submission-readiness.ts` | GET | `/readiness` | Compute readiness checks |
| `check-compliance.ts` | GET | `/compliance` | Full compliance report |
| `get-submission-history.ts` | GET | `/history` | List past submissions |
| `withdraw-submission.ts` | POST | `/withdraw` | Withdraw a submission |

### Compliance Checks

Checks are organized in 5 categories:

| Category | Checks |
|----------|--------|
| **submission_readiness** | Stage is PURSUING, questions extracted, all answered, all approved, required docs present, no generating, no failed, all approved |
| **format_compliance** | Document naming, file formats, page counts |
| **document_completeness** | Required sections present, brief requirements met |
| **content_validation** | Content quality, placeholder detection |
| **quality_checks** | Consistency, formatting |

### Data Model

```
ProposalSubmissionItem {
  submissionId: uuid
  orgId, projectId, oppId: string
  status: 'SUBMITTED' | 'WITHDRAWN'
  submissionMethod: 'PORTAL' | 'EMAIL' | 'MANUAL' | 'HAND_DELIVERY' | 'OTHER'
  submittedAt: datetime
  submittedBy: userId
  submittedByName?: string
  submissionReference?: string
  submissionNotes?: string
  portalUrl?: url
  documentIds: string[]  // snapshot of submitted docs
  deadlineIso?: datetime
}
```

DynamoDB: PK=`PROPOSAL_SUBMISSION`, SK=`{orgId}#{projectId}#{oppId}#{submissionId}`

### Ignored Checks

Stored on the opportunity entity as `ignoredComplianceCheckIds: string[]`. Respected by:
- Frontend: ComplianceReport UI, SubmitProposalButton state, submit page
- Backend: readiness endpoint, compliance endpoint, submit validation
