import { v4 as uuidv4 } from 'uuid';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createItem, putItem, queryBySkPrefix, docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { PROPOSAL_SUBMISSION_PK } from '@/constants/proposal-submission';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { PK_NAME, SK_NAME } from '@/constants/common';
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

/** Load all questions for a project+opportunity using the new SK prefix */
const listQuestionsForOpportunity = async (
  projectId: string,
  oppId: string,
): Promise<Array<{ questionId: string }>> => {
  // New SK pattern: {projectId}#{oppId}#{fileId}#{questionId}
  // Query by {projectId}#{oppId}# prefix to get all files for this opportunity
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': QUESTION_PK,
        ':prefix': `${projectId}#${oppId}#`,
      },
    }),
  );
  return (res.Items ?? []) as Array<{ questionId: string }>;
};

/** Load all answers for a project+opportunity using the new SK prefix */
const listAnswersForOpportunity = async (
  projectId: string,
  oppId: string,
): Promise<Array<{ questionId: string; text: string; status: string }>> => {
  // New SK pattern: {projectId}#{oppId}#{fileId}#{questionId}
  // Query by {projectId}#{oppId}# prefix to get all files for this opportunity
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': ANSWER_PK,
        ':prefix': `${projectId}#${oppId}#`,
      },
    }),
  );
  return (res.Items ?? []) as Array<{ questionId: string; text: string; status: string }>;
};

// ─── Readiness Validation ─────────────────────────────────────────────────────

/**
 * Checks whether the proposal is ready to submit.
 *
 * BLOCKING (must fix before submitting):
 *   1. Opportunity is in PURSUING stage
 *   2. Questions exist for this opportunity
 *   3. All questions have answers
 *   4. All answers are APPROVED (not DRAFT)
 *   5. Required documents present (Technical + Cost Proposal)
 *   6. No documents still generating
 *   7. No failed document generation
 *   8. All documents approved (FULLY_SIGNED or NOT_REQUIRED)
 *
 * WARNING (can submit anyway, but should review):
 *   9. Submission deadline not passed
 *  10. Not already submitted (allows re-submission for amendments)
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
  const activeDocs = allDocs.filter((d) => !d['deletedAt']);

  // ── BLOCKING 5: Required documents present ──
  const hasTechnical = activeDocs.some((d) => d['documentType'] === 'TECHNICAL_PROPOSAL');
  const hasCost = activeDocs.some((d) => d['documentType'] === 'COST_PROPOSAL');
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
  const generatingDocs = activeDocs.filter((d) => d['status'] === 'GENERATING');
  checks.push({
    id: 'no_generating',
    label: 'All AI generation complete',
    description: 'Wait for all AI document generation to finish before submitting.',
    passed: generatingDocs.length === 0,
    detail: generatingDocs.length === 0
      ? 'All documents are ready'
      : `Still generating: ${generatingDocs.map((d) => d['name']).join(', ')}`,
    blocking: true,
  });

  // ── BLOCKING 7: No failed generation ──
  const failedDocs = activeDocs.filter((d) => d['status'] === 'FAILED');
  checks.push({
    id: 'no_failed_generation',
    label: 'No failed document generation',
    description: 'Regenerate or delete documents that failed to generate.',
    passed: failedDocs.length === 0,
    detail: failedDocs.length === 0
      ? 'All documents generated successfully'
      : `Failed: ${failedDocs.map((d) => d['name']).join(', ')} — regenerate or delete these`,
    blocking: true,
  });

  // ── BLOCKING 8: All documents approved (signed or not required) ──
  const unapprovedDocs = activeDocs.filter(
    (d) => d['signatureStatus'] !== 'FULLY_SIGNED' && d['signatureStatus'] !== 'NOT_REQUIRED',
  );
  checks.push({
    id: 'documents_approved',
    label: 'All documents approved',
    description: 'All documents must be fully signed or marked as not requiring signature.',
    passed: unapprovedDocs.length === 0,
    detail: unapprovedDocs.length === 0
      ? `All ${activeDocs.length} document(s) approved`
      : `${unapprovedDocs.length} document(s) not yet approved: ${unapprovedDocs.map((d) => d['name']).join(', ')}`,
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

export const withdrawSubmissionRecord = async (
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
