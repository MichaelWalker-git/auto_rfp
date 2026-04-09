import { v4 as uuidv4 } from 'uuid';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createItem, putItem, queryBySkPrefix, docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { listQuestionFilesByOpportunity } from '@/helpers/questionFile';
import { PROPOSAL_SUBMISSION_PK } from '@/constants/proposal-submission';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { getExecutiveBriefByProjectId } from '@/helpers/executive-opportunity-brief';
import type {
  ProposalSubmissionItem,
  SubmitProposal,
  ReadinessCheckItem,
  SubmissionReadinessResponse,
  ComplianceReport,
  ComplianceCategorySummary,
  ComplianceCheckCategory,
  ExecutiveBriefItem,
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

/** Load all questions for a project+opportunity using the new SK prefix,
 *  filtering out questions from non-PROCESSED question files (orphans from
 *  cancelled/failed pipelines). */
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
  const allQuestions = (res.Items ?? []) as Array<{ questionId: string; questionFileId?: string }>;

  // Build set of PROCESSED file IDs to filter out orphaned questions
  const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId });
  const processedFileIds = new Set(
    (questionFiles as Array<{ questionFileId: string; status: string }>)
      .filter((qf) => qf.status === 'PROCESSED')
      .map((qf) => qf.questionFileId),
  );

  return allQuestions.filter((q) => {
    // Keep manually-added questions (no file) and questions from PROCESSED files
    if (!q.questionFileId || q.questionFileId === 'manual') return true;
    return processedFileIds.has(q.questionFileId);
  });
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
  ignoredCheckIds?: string[];
}): Promise<SubmissionReadinessResponse> => {
  const { orgId, projectId, oppId, deadlineIso, currentStage, ignoredCheckIds } = args;
  const ignoredSet = new Set(ignoredCheckIds ?? []);
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

  const blockingFails = checks.filter((c) => c.blocking && !c.passed && !ignoredSet.has(c.id)).length;
  const warningFails = checks.filter((c) => !c.blocking && !c.passed && !ignoredSet.has(c.id)).length;

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
  return items.sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
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

// ─── Format Compliance Checks ─────────────────────────────────────────────────

/**
 * Extracts the brief's submissionCompliance data and checks format rules
 * against the actual documents for this opportunity.
 */
export const checkFormatCompliance = async (args: {
  projectId: string;
  oppId: string;
  activeDocs: Array<Record<string, unknown>>;
  brief: ExecutiveBriefItem | null;
}): Promise<ReadinessCheckItem[]> => {
  const { activeDocs, brief } = args;
  const checks: ReadinessCheckItem[] = [];

  // Extract submission compliance from the brief's requirements section
  const sections = brief?.sections as Record<string, unknown> | undefined;
  const reqSection = sections?.requirements as Record<string, unknown> | undefined;
  const reqData = reqSection?.data as Record<string, unknown> | undefined;
  const compliance = reqData?.submissionCompliance as Record<string, unknown> | undefined;
  const formatRules = (compliance?.format ?? []) as string[];

  // ── Check: File types match common RFP requirements ──
  const STANDARD_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/html',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]);
  const MIME_LABELS: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/msword': 'DOC',
    'text/html': 'HTML',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  };
  const nonStandardDocs = activeDocs.filter((d) => {
    const mime = d['mimeType'] as string | undefined;
    return mime && !STANDARD_MIME_TYPES.has(mime);
  });
  const docFormats = activeDocs
    .map((d) => MIME_LABELS[d['mimeType'] as string] ?? d['mimeType'] as string)
    .filter(Boolean);
  const uniqueFormats = [...new Set(docFormats)];

  // Check if the brief's format rules mention specific file type requirements
  const formatRulesLower = formatRules.map((r) => r.toLowerCase());
  const requiresPdf = formatRulesLower.some((r) => r.includes('pdf'));
  const requiresWord = formatRulesLower.some((r) => r.includes('word') || r.includes('docx') || r.includes('.doc'));
  const hasSpecificFormatReq = requiresPdf || requiresWord;

  if (hasSpecificFormatReq) {
    // RFP specifies file type requirements — check against actual documents
    const nonPdfDocs = requiresPdf
      ? activeDocs.filter((d) => d['mimeType'] && d['mimeType'] !== 'application/pdf')
      : [];
    const nonWordDocs = requiresWord
      ? activeDocs.filter((d) => {
          const mime = d['mimeType'] as string | undefined;
          return mime && mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && mime !== 'application/msword';
        })
      : [];
    const mismatchDocs = requiresPdf ? nonPdfDocs : nonWordDocs;
    const requiredFormat = requiresPdf ? 'PDF' : 'Word (DOCX)';

    checks.push({
      id: 'file_type_compliance',
      label: `File types match RFP requirement (${requiredFormat})`,
      description: `The RFP format rules indicate ${requiredFormat} is required. Documents in other formats may need conversion.`,
      passed: mismatchDocs.length === 0,
      detail: mismatchDocs.length === 0
        ? `All documents are in ${requiredFormat} format as required`
        : `${mismatchDocs.length} document(s) not in ${requiredFormat}: ${mismatchDocs.map((d) => `${d['name']} (${MIME_LABELS[d['mimeType'] as string] ?? d['mimeType']})`).join(', ')}`,
      blocking: false,
      category: 'format_compliance',
    });
  } else if (nonStandardDocs.length > 0) {
    // No specific RFP requirement — warn about non-standard types
    checks.push({
      id: 'file_type_compliance',
      label: 'File types are submission-compatible',
      description: 'Documents should be in standard formats (PDF, DOCX, XLSX) commonly accepted by agencies.',
      passed: false,
      detail: `${nonStandardDocs.length} document(s) use non-standard formats: ${nonStandardDocs.map((d) => `${d['name']} (${d['mimeType']})`).join(', ')} — verify the agency accepts these`,
      blocking: false,
      category: 'format_compliance',
    });
  } else {
    checks.push({
      id: 'file_type_compliance',
      label: 'File types are submission-compatible',
      description: 'All documents use standard formats accepted by government agencies.',
      passed: true,
      detail: `All ${activeDocs.length} document(s) use standard formats (${uniqueFormats.join(', ')})`,
      blocking: false,
      category: 'format_compliance',
    });
  }

  // ── Check: File naming conventions ──
  const docsWithBadNames = activeDocs.filter((d) => {
    const name = (d['name'] as string | undefined) ?? '';
    // Check for common naming issues: special chars, very long names, no extension
    return name.length > 100 || /[<>:"/\\|?*]/.test(name);
  });
  checks.push({
    id: 'file_naming_conventions',
    label: 'File naming conventions',
    description: 'Document names should be clean, descriptive, and free of special characters.',
    passed: docsWithBadNames.length === 0,
    detail: docsWithBadNames.length === 0
      ? 'All document names follow naming conventions'
      : `${docsWithBadNames.length} document(s) have naming issues: ${docsWithBadNames.map((d) => d['name']).join(', ')}`,
    blocking: false,
    category: 'format_compliance',
  });

  // ── Check: Format rules from brief (page limits, font, margins) ──
  if (formatRules.length > 0) {
    checks.push({
      id: 'rfp_format_rules',
      label: 'RFP format requirements identified',
      description: 'Format rules extracted from the solicitation. Review these manually before submission.',
      passed: true,
      detail: `${formatRules.length} format rule(s) from RFP: ${formatRules.slice(0, 3).join('; ')}${formatRules.length > 3 ? ` (+${formatRules.length - 3} more)` : ''}`,
      blocking: false,
      category: 'format_compliance',
    });
  } else {
    checks.push({
      id: 'rfp_format_rules',
      label: 'RFP format requirements',
      description: 'No specific format rules were extracted from the solicitation.',
      passed: true,
      detail: 'No format rules found in the Executive Brief — verify manually if the RFP specifies page limits, font, or margin requirements',
      blocking: false,
      category: 'format_compliance',
    });
  }

  // ── Check: Page limits per section (from brief's requiredDocuments) ──
  const requiredDocs = (compliance?.requiredDocuments ?? []) as Array<Record<string, unknown>>;
  const docsWithPageLimits = requiredDocs.filter((rd) => rd['pageLimit']);
  if (docsWithPageLimits.length > 0) {
    const pageLimitDetails = docsWithPageLimits.map((rd) =>
      `${rd['name'] as string}: ${rd['pageLimit'] as string}`,
    );
    checks.push({
      id: 'page_limits_identified',
      label: 'Page limits per section',
      description: 'The RFP specifies page limits for certain sections. Verify compliance before submission.',
      passed: true,
      detail: `Page limits: ${pageLimitDetails.join('; ')}`,
      blocking: false,
      category: 'format_compliance',
    });
  }

  return checks;
};

// ─── Document Completeness Checks ─────────────────────────────────────────────

/**
 * Checks document completeness against the brief's required documents list.
 * Goes beyond the basic Technical + Cost check to validate all RFP-required documents.
 */
export const checkDocumentCompleteness = async (args: {
  activeDocs: Array<Record<string, unknown>>;
  brief: ExecutiveBriefItem | null;
}): Promise<ReadinessCheckItem[]> => {
  const { activeDocs, brief } = args;
  const checks: ReadinessCheckItem[] = [];

  const sections = brief?.sections as Record<string, unknown> | undefined;
  const reqSection = sections?.requirements as Record<string, unknown> | undefined;
  const reqData = reqSection?.data as Record<string, unknown> | undefined;
  const compliance = reqData?.submissionCompliance as Record<string, unknown> | undefined;
  const requiredDocs = (compliance?.requiredDocuments ?? []) as Array<Record<string, unknown>>;
  const requiredVolumes = (compliance?.requiredVolumes ?? []) as string[];
  const attachmentsAndForms = (compliance?.attachmentsAndForms ?? []) as string[];

  // ── Check: RFP-required documents from brief ──
  if (requiredDocs.length > 0) {
    const activeDocTypes = new Set(activeDocs.map((d) => d['documentType'] as string));
    const missingRequired = requiredDocs
      .filter((rd) => rd['required'] !== false)
      .filter((rd) => !activeDocTypes.has(rd['documentType'] as string));

    checks.push({
      id: 'rfp_required_documents',
      label: 'All RFP-required documents present',
      description: 'Documents required by the solicitation (Section L) must be included.',
      passed: missingRequired.length === 0,
      detail: missingRequired.length === 0
        ? `All ${requiredDocs.filter((rd) => rd['required'] !== false).length} required document type(s) present`
        : `Missing ${missingRequired.length} required document(s): ${missingRequired.map((rd) => rd['name']).join(', ')}`,
      blocking: true,
      category: 'document_completeness',
    });
  }

  // ── Check: Required volumes from brief ──
  if (requiredVolumes.length > 0) {
    checks.push({
      id: 'required_volumes',
      label: 'Required proposal volumes',
      description: 'The RFP specifies required volumes. Verify all are included.',
      passed: true,
      detail: `Required volumes: ${requiredVolumes.join(', ')} — verify these are covered by your documents`,
      blocking: false,
      category: 'document_completeness',
    });
  }

  // ── Check: Certifications document ──
  const hasCertifications = activeDocs.some((d) => d['documentType'] === 'CERTIFICATIONS');
  checks.push({
    id: 'certifications_document',
    label: 'Certifications & representations',
    description: 'Most government RFPs require certifications and representations (FAR 52.204-8, etc.).',
    passed: hasCertifications,
    detail: hasCertifications
      ? 'Certifications document found'
      : 'No Certifications document — many RFPs require representations and certifications',
    blocking: false,
    category: 'document_completeness',
  });

  // ── Check: Past performance references ──
  const hasPastPerf = activeDocs.some((d) => d['documentType'] === 'PAST_PERFORMANCE');
  checks.push({
    id: 'past_performance_document',
    label: 'Past performance references',
    description: 'Past performance is a key evaluation factor in most government proposals.',
    passed: hasPastPerf,
    detail: hasPastPerf
      ? 'Past Performance document found'
      : 'No Past Performance document — this is typically required for evaluation',
    blocking: false,
    category: 'document_completeness',
  });

  // ── Check: Attachments and forms from brief ──
  if (attachmentsAndForms.length > 0) {
    checks.push({
      id: 'attachments_and_forms',
      label: 'Required attachments & forms',
      description: 'The RFP specifies required attachments and forms.',
      passed: true,
      detail: `Required forms: ${attachmentsAndForms.slice(0, 3).join('; ')}${attachmentsAndForms.length > 3 ? ` (+${attachmentsAndForms.length - 3} more)` : ''} — verify these are included`,
      blocking: false,
      category: 'document_completeness',
    });
  }

  return checks;
};

// ─── Content Validation Checks ────────────────────────────────────────────────

/**
 * Validates that proposal content addresses key evaluation criteria
 * and includes required content elements.
 */
export const checkContentValidation = async (args: {
  activeDocs: Array<Record<string, unknown>>;
  brief: ExecutiveBriefItem | null;
}): Promise<ReadinessCheckItem[]> => {
  const { activeDocs, brief } = args;
  const checks: ReadinessCheckItem[] = [];

  const sections = brief?.sections as Record<string, unknown> | undefined;
  const reqSection = sections?.requirements as Record<string, unknown> | undefined;
  const reqData = reqSection?.data as Record<string, unknown> | undefined;
  const evaluationFactors = (reqData?.evaluationFactors ?? []) as string[];

  // ── Check: Evaluation criteria identified ──
  if (evaluationFactors.length > 0) {
    checks.push({
      id: 'evaluation_criteria_identified',
      label: 'Evaluation criteria addressed',
      description: 'The RFP evaluation factors should be explicitly addressed in your proposal.',
      passed: true,
      detail: `${evaluationFactors.length} evaluation factor(s): ${evaluationFactors.slice(0, 3).join('; ')}${evaluationFactors.length > 3 ? ` (+${evaluationFactors.length - 3} more)` : ''} — verify each is addressed`,
      blocking: false,
      category: 'content_validation',
    });
  }

  // ── Check: Compliance matrix present ──
  const hasComplianceMatrix = activeDocs.some((d) => d['documentType'] === 'COMPLIANCE_MATRIX');
  checks.push({
    id: 'compliance_matrix',
    label: 'Compliance matrix included',
    description: 'A compliance matrix maps every RFP requirement to your proposal response location.',
    passed: hasComplianceMatrix,
    detail: hasComplianceMatrix
      ? 'Compliance Matrix document found — helps evaluators verify full coverage'
      : 'No Compliance Matrix — consider adding one to prove requirement coverage',
    blocking: false,
    category: 'content_validation',
  });

  // ── Check: Cover letter present ──
  const hasCoverLetter = activeDocs.some((d) => d['documentType'] === 'COVER_LETTER');
  checks.push({
    id: 'cover_letter',
    label: 'Cover letter included',
    description: 'A cover letter (transmittal letter) is standard for government proposal submissions.',
    passed: hasCoverLetter,
    detail: hasCoverLetter
      ? 'Cover Letter found'
      : 'No Cover Letter — most submissions require a signed transmittal letter',
    blocking: false,
    category: 'content_validation',
  });

  // ── Check: Executive summary present ──
  const hasExecSummary = activeDocs.some((d) => d['documentType'] === 'EXECUTIVE_SUMMARY');
  checks.push({
    id: 'executive_summary',
    label: 'Executive summary included',
    description: 'The executive summary is the most-read section of any proposal.',
    passed: hasExecSummary,
    detail: hasExecSummary
      ? 'Executive Summary found'
      : 'No Executive Summary — this is the most-read section by evaluators',
    blocking: false,
    category: 'content_validation',
  });

  // ── Check: Pricing format (cost proposal has content) ──
  const costDoc = activeDocs.find((d) => d['documentType'] === 'COST_PROPOSAL');
  if (costDoc) {
    const hasContent = costDoc['content'] || costDoc['htmlContentKey'] || costDoc['fileKey'];
    checks.push({
      id: 'pricing_format',
      label: 'Cost proposal has content',
      description: 'The cost proposal must contain pricing data.',
      passed: !!hasContent,
      detail: hasContent
        ? 'Cost Proposal has content'
        : 'Cost Proposal exists but appears empty — add pricing data',
      blocking: true,
      category: 'content_validation',
    });
  }

  return checks;
};

// ─── Quality Checks (Non-Critical) ───────────────────────────────────────────

/**
 * Non-critical quality checks for professional polish.
 * These are warnings only — they don't block submission.
 */
export const checkQuality = async (args: {
  activeDocs: Array<Record<string, unknown>>;
}): Promise<ReadinessCheckItem[]> => {
  const { activeDocs } = args;
  const checks: ReadinessCheckItem[] = [];

  // ── Check: Consistent document naming ──
  const docNames = activeDocs.map((d) => (d['name'] as string | undefined) ?? '');
  const hasInconsistentCasing = docNames.some((n) => n === n.toLowerCase()) &&
    docNames.some((n) => n !== n.toLowerCase() && n !== n.toUpperCase());
  checks.push({
    id: 'consistent_naming',
    label: 'Consistent document naming',
    description: 'Document names should follow a consistent naming convention.',
    passed: !hasInconsistentCasing || docNames.length <= 1,
    detail: hasInconsistentCasing && docNames.length > 1
      ? 'Document names use inconsistent casing — consider standardizing'
      : 'Document naming appears consistent',
    blocking: false,
    category: 'quality_checks',
  });

  // ── Check: No very small documents (potential empty/placeholder) ──
  const tinyDocs = activeDocs.filter((d) => {
    const size = d['fileSizeBytes'] as number | undefined;
    return size !== undefined && size > 0 && size < 1024; // Less than 1KB
  });
  checks.push({
    id: 'no_placeholder_documents',
    label: 'No placeholder documents',
    description: 'Very small documents may be placeholders that need content.',
    passed: tinyDocs.length === 0,
    detail: tinyDocs.length === 0
      ? 'All documents have substantial content'
      : `${tinyDocs.length} document(s) are very small (<1KB) — may be placeholders: ${tinyDocs.map((d) => d['name']).join(', ')}`,
    blocking: false,
    category: 'quality_checks',
  });

  // ── Check: All documents have been updated recently ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const staleDocs = activeDocs.filter((d) => {
    const updatedAt = d['updatedAt'] as string | undefined;
    return updatedAt && updatedAt < thirtyDaysAgo;
  });
  checks.push({
    id: 'documents_recently_updated',
    label: 'Documents are up to date',
    description: 'Documents should be reviewed and updated before submission.',
    passed: staleDocs.length === 0,
    detail: staleDocs.length === 0
      ? 'All documents updated within the last 30 days'
      : `${staleDocs.length} document(s) not updated in 30+ days — review before submitting`,
    blocking: false,
    category: 'quality_checks',
  });

  return checks;
};

// ─── Compliance Report Generation ─────────────────────────────────────────────

const CATEGORY_LABELS: Record<ComplianceCheckCategory, string> = {
  submission_readiness: 'Submission Readiness',
  format_compliance: 'Format Compliance',
  document_completeness: 'Document Completeness',
  content_validation: 'Content Validation',
  quality_checks: 'Quality Checks',
};

const CATEGORY_ORDER: ComplianceCheckCategory[] = [
  'submission_readiness',
  'format_compliance',
  'document_completeness',
  'content_validation',
  'quality_checks',
];

/**
 * Generates a full compliance report by running all check categories:
 * 1. Submission readiness (existing checks with category tags)
 * 2. Format compliance (file types, naming, page limits)
 * 3. Document completeness (RFP-required documents from brief)
 * 4. Content validation (evaluation criteria, key sections)
 * 5. Quality checks (descriptions, naming consistency, staleness)
 */
export const generateComplianceReport = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  deadlineIso?: string | null;
  currentStage?: string | null;
  ignoredCheckIds?: string[];
}): Promise<ComplianceReport> => {
  const { orgId, projectId, oppId, deadlineIso, currentStage, ignoredCheckIds } = args;
  const ignoredSet = new Set(ignoredCheckIds ?? []);

  // ── 1. Run existing readiness checks (tagged as submission_readiness) ──
  const readiness = await checkSubmissionReadiness({ orgId, projectId, oppId, deadlineIso, currentStage, ignoredCheckIds });
  const readinessChecks: ReadinessCheckItem[] = readiness.checks.map((c) => ({
    ...c,
    category: 'submission_readiness' as const,
  }));

  // ── 2. Load brief for compliance data ──
  let brief: ExecutiveBriefItem | null = null;
  try {
    brief = await getExecutiveBriefByProjectId(projectId, oppId);
  } catch {
    // Brief may not exist yet — that's OK, compliance checks will be limited
    console.warn('[compliance-report] Could not load executive brief — some checks will be skipped');
  }

  // ── 3. Load documents (reuse from readiness if possible) ──
  const { items: allDocs } = await listRFPDocumentsByProject({ projectId, opportunityId: oppId });
  const activeDocs = allDocs.filter((d) => !d['deletedAt']) as Array<Record<string, unknown>>;

  // ── 4. Run all compliance check categories ──
  const formatChecks = await checkFormatCompliance({ projectId, oppId, activeDocs, brief });
  const completenessChecks = await checkDocumentCompleteness({ activeDocs, brief });
  const contentChecks = await checkContentValidation({ activeDocs, brief });
  const qualityChecks = await checkQuality({ activeDocs });

  // ── 5. Combine all checks ──
  const allChecks: ReadinessCheckItem[] = [
    ...readinessChecks,
    ...formatChecks,
    ...completenessChecks,
    ...contentChecks,
    ...qualityChecks,
  ];

  // ── 6. Build category summaries ──
  const categories: ComplianceCategorySummary[] = CATEGORY_ORDER.map((cat) => {
    const catChecks = allChecks.filter((c) => (c.category ?? 'submission_readiness') === cat);
    const effectiveFailedCount = catChecks.filter((c) => !c.passed && !ignoredSet.has(c.id)).length;
    const effectivePassedCount = catChecks.length - effectiveFailedCount;
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      totalChecks: catChecks.length,
      passed: effectivePassedCount,
      failed: effectiveFailedCount,
      allPassed: effectiveFailedCount === 0,
      checks: catChecks,
    };
  }).filter((cat) => cat.totalChecks > 0); // Only include categories with checks

  // ── 7. Compute summary stats (excluding ignored checks) ──
  const blockingFails = allChecks.filter((c) => c.blocking && !c.passed && !ignoredSet.has(c.id)).length;
  const warningFails = allChecks.filter((c) => !c.blocking && !c.passed && !ignoredSet.has(c.id)).length;
  const totalChecks = allChecks.length;
  const effectivePassed = allChecks.filter((c) => c.passed || ignoredSet.has(c.id)).length;
  const passRate = totalChecks > 0 ? Math.round((effectivePassed / totalChecks) * 100) : 100;

  return {
    ready: blockingFails === 0,
    checks: allChecks,
    blockingFails,
    warningFails,
    categories,
    generatedAt: nowIso(),
    totalChecks,
    passRate,
  };
};
