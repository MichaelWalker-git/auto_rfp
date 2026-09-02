import type { QuestionFileStatus, DetectedFormField } from '@auto-rfp/core';
import type {
  StepId,
  StepEvaluation,
  StepDataSnapshot,
  SolicitationsDomain,
  AnalysisDomain,
  SolutionPlanDomain,
  RequiredFormsDomain,
  RfpDocumentsDomain,
  AiReviewDomain,
  SubmissionDomain,
} from './types';

// ─── Shared constants ──────────────────────────────────────────────────────────

/** Solicitation-file statuses that count as "fully processed" (text extracted or
 *  beyond). Statuses before these are mid-pipeline; FAILED/CANCELLED are neither. */
const SOLICITATION_PROCESSED_STATUSES = new Set<QuestionFileStatus>([
  'PROCESSED',
  'GENERATING_ANSWERS',
  'ANSWERS_READY',
  'FILLING_FORMS',
  'FORMS_READY',
]);

/** Terminal solicitation-file statuses that indicate a processing failure. */
const SOLICITATION_FAILED_STATUSES = new Set<QuestionFileStatus>(['FAILED', 'CANCELLED']);

/** RFP-document statuses that count as done. */
const RFP_DONE_STATUSES = new Set(['READY', 'APPROVED']);

/** Compliance-finding severities that block submission. */
const BLOCKING_SEVERITIES = new Set(['critical', 'major']);

/** The eight executive-brief section keys (authoritative order). */
export const ANALYSIS_SECTION_KEYS = [
  'summary',
  'deadlines',
  'requirements',
  'contacts',
  'risks',
  'pricing',
  'pastPerformance',
  'scoring',
] as const;

/** Reason attached by the uniform re-upload staleness layer (BR2.1). */
export const REUPLOAD_STALE_REASON = 'Outdated — new solicitation uploaded';

/** Steps whose staleness is decided by a native server signal (BR2.2). The uniform
 *  re-upload layer (BR2.1) is never applied to these. */
export const NATIVE_STALE_STEPS = new Set<StepId>(['solution-plan', 'ai-review']);

// ─── Helpers ───────────────────────────────────────────────────────────────────

const unavailable = (stepId: StepId): StepEvaluation => ({
  stepId,
  status: 'unavailable',
  detailText: 'Status unavailable',
});

/** A single detected field counts as filled once it carries committed content —
 *  a non-empty text value, or a stamped mark for a checkbox/circle field. An
 *  untouched (EMPTY) field is not filled. */
const isFieldFilled = (
  field: Pick<DetectedFormField, 'value' | 'markChar'>,
): boolean =>
  (typeof field.value === 'string' && field.value.trim().length > 0) ||
  (typeof field.markChar === 'string' && field.markChar.trim().length > 0);

/** Count of a form's fields still awaiting a value (drives the details hint). */
export const unfilledFieldCount = (form: {
  fields?: Pick<DetectedFormField, 'value' | 'markChar'>[];
}): number => {
  const fields = form.fields;
  if (!Array.isArray(fields)) return 0;
  return fields.filter((f) => !isFieldFilled(f)).length;
};

/** A form is finished once it has ≥1 field and every field is filled. This tracks
 *  actual completion of the fields — NOT `manualFieldCount === 0`, because the
 *  MANUAL_REQUIRED "needs review" flag has no clearing mechanism (a filled
 *  manual field keeps the flag), so that never reaches zero. */
export const isFormFilled = (form: {
  totalFieldCount: number;
  fields?: Pick<DetectedFormField, 'value' | 'markChar'>[];
}): boolean => {
  if (form.totalFieldCount <= 0) return false;
  const fields = form.fields;
  if (!Array.isArray(fields) || fields.length === 0) return false;
  return fields.every(isFieldFilled);
};

// ─── Per-step rules ─────────────────────────────────────────────────────────────
// Every rule is pure and never throws: an absent/malformed slice returns `unavailable`.

/** Solicitations — complete only when ≥1 non-deleted file exists and every
 *  non-deleted file is fully processed. Detail "X of Y processed". */
export const evaluateSolicitations = (
  snap: StepDataSnapshot<SolicitationsDomain>,
): StepEvaluation => {
  const files = snap.domainData?.files;
  if (!Array.isArray(files)) return unavailable('solicitations');

  const nonDeleted = files.filter((f) => f?.status !== 'DELETED');
  const total = nonDeleted.length;
  const processed = nonDeleted.filter((f) =>
    SOLICITATION_PROCESSED_STATUSES.has(f?.status as QuestionFileStatus),
  ).length;
  const detailText = `${processed} of ${total} processed`;

  if (total === 0) return { stepId: 'solicitations', status: 'not-started', detailText };

  // A file that failed/cancelled can never reach "processed" — surface it as
  // needs-attention rather than pinning the step at in-progress forever.
  const hasFailure = nonDeleted.some((f) =>
    SOLICITATION_FAILED_STATUSES.has(f?.status as QuestionFileStatus),
  );
  if (hasFailure) {
    return {
      stepId: 'solicitations',
      status: 'needs-attention',
      detailText,
      reason: 'A document failed to process — remove or re-upload it',
    };
  }

  if (processed === total) return { stepId: 'solicitations', status: 'complete', detailText };
  return { stepId: 'solicitations', status: 'in-progress', detailText };
};

/** Analysis — complete only when all 8 brief sections are COMPLETE.
 *  Detail "N of 8 sections". */
export const evaluateAnalysis = (
  snap: StepDataSnapshot<AnalysisDomain>,
): StepEvaluation => {
  if (snap.domainData === undefined) return unavailable('analysis');
  const brief = snap.domainData.brief;
  const total = ANALYSIS_SECTION_KEYS.length;

  if (!brief) {
    return { stepId: 'analysis', status: 'not-started', detailText: `0 of ${total} sections` };
  }

  const sections = brief.sections;
  if (!sections || typeof sections !== 'object') return unavailable('analysis');

  const complete = ANALYSIS_SECTION_KEYS.filter(
    (key) => sections[key]?.status === 'COMPLETE',
  ).length;
  const detailText = `${complete} of ${total} sections`;

  if (complete === total) return { stepId: 'analysis', status: 'complete', detailText };
  return { stepId: 'analysis', status: 'in-progress', detailText };
};

/** Solution Plan — status word; READY + isStale flips to needs-attention via the
 *  NATIVE signal (detail preserved as "Ready"). */
export const evaluateSolutionPlan = (
  snap: StepDataSnapshot<SolutionPlanDomain>,
): StepEvaluation => {
  if (snap.domainData === undefined) return unavailable('solution-plan');
  const plan = snap.domainData.plan;

  if (!plan) return { stepId: 'solution-plan', status: 'not-started', detailText: 'Not started' };

  switch (plan.status) {
    case 'GRILLING':
    case 'GENERATING_SOT':
      return { stepId: 'solution-plan', status: 'in-progress', detailText: 'Generating' };
    case 'READY':
      if (plan.isStale) {
        return {
          stepId: 'solution-plan',
          status: 'needs-attention',
          detailText: 'Ready',
          reason: plan.staleReason || REUPLOAD_STALE_REASON,
        };
      }
      return { stepId: 'solution-plan', status: 'complete', detailText: 'Ready' };
    case 'FAILED':
      return {
        stepId: 'solution-plan',
        status: 'needs-attention',
        detailText: 'Failed',
        reason: 'Plan generation failed — regenerate the plan',
      };
    default:
      return unavailable('solution-plan');
  }
};

/** Required Forms — complete only when ≥1 form detected and every form is fully
 *  filled. Detail "X of Y filled". Returns not-started when none detected; the
 *  assembly (not the rule) hides the step in that case. */
export const evaluateRequiredForms = (
  snap: StepDataSnapshot<RequiredFormsDomain>,
): StepEvaluation => {
  const forms = snap.domainData?.forms;
  if (!Array.isArray(forms)) return unavailable('required-forms');

  const total = forms.length;
  if (total === 0) {
    return { stepId: 'required-forms', status: 'not-started', detailText: 'No required forms' };
  }

  const filled = forms.filter(isFormFilled).length;
  const detailText = `${filled} of ${total} filled`;

  if (filled === total) return { stepId: 'required-forms', status: 'complete', detailText };
  return { stepId: 'required-forms', status: 'in-progress', detailText };
};

/** RFP Documents — primary path counts against the brief's required-documents list
 *  ("X of Y required"); fallback counts ready/approved of existing docs ("X of Y ready"). */
export const evaluateRfpDocuments = (
  snap: StepDataSnapshot<RfpDocumentsDomain>,
): StepEvaluation => {
  const documents = snap.domainData?.documents;
  if (!Array.isArray(documents)) return unavailable('rfp-documents');

  const requiredDocuments = snap.domainData?.requiredDocuments;
  const readyDocs = documents.filter((d) => RFP_DONE_STATUSES.has(d?.status ?? ''));

  // Primary path: the brief carries a required-documents list. Only entries whose
  // `required` flag isn't explicitly false count toward the mandatory total — an
  // optional/attachment document must never gate the step.
  const mandatoryDocs = Array.isArray(requiredDocuments)
    ? requiredDocuments.filter((req) => req.required !== false)
    : [];
  if (mandatoryDocs.length > 0) {
    const readyTypes = new Set(readyDocs.map((d) => d.documentType));
    const total = mandatoryDocs.length;
    const satisfied = mandatoryDocs.filter((req) => readyTypes.has(req.documentType)).length;
    const detailText = `${satisfied} of ${total} required`;

    if (satisfied === total) return { stepId: 'rfp-documents', status: 'complete', detailText };
    if (satisfied === 0) return { stepId: 'rfp-documents', status: 'not-started', detailText };
    return { stepId: 'rfp-documents', status: 'in-progress', detailText };
  }

  // Fallback path: count ready/approved over the documents that exist.
  const total = documents.length;
  const detailText = `${readyDocs.length} of ${total} ready`;
  if (total === 0) return { stepId: 'rfp-documents', status: 'not-started', detailText };
  if (readyDocs.length === total) return { stepId: 'rfp-documents', status: 'complete', detailText };
  return { stepId: 'rfp-documents', status: 'in-progress', detailText };
};

/** AI Review — explicit precedence chain (first match wins). The native `stale`
 *  signal wins even over open findings (BR2.2). */
export const evaluateAiReview = (
  snap: StepDataSnapshot<AiReviewDomain>,
): StepEvaluation => {
  const data = snap.domainData;
  if (data === undefined || !Array.isArray(data.findings) || !Array.isArray(data.decisions)) {
    return unavailable('ai-review');
  }

  // 1. No run → not-started.
  if (!data.run) return { stepId: 'ai-review', status: 'not-started', detailText: 'Not started' };

  // 2. Latest run RUNNING → in-progress.
  if (data.run.status === 'RUNNING') {
    return { stepId: 'ai-review', status: 'in-progress', detailText: 'Running' };
  }

  // 2b. Latest run FAILED → needs-attention (never report a failed review as complete).
  if (data.run.status === 'FAILED') {
    return {
      stepId: 'ai-review',
      status: 'needs-attention',
      detailText: 'Failed',
      reason: 'Compliance review failed — re-run it',
    };
  }

  const decided = new Set(
    data.decisions
      .filter((d) => d.state === 'resolved' || d.state === 'dismissed')
      .map((d) => d.fingerprint),
  );
  const openFindings = data.findings.filter((f) => !decided.has(f.fingerprint));
  const openCount = openFindings.length;
  const countLabel = `${openCount} open finding${openCount === 1 ? '' : 's'}`;

  // 3. Run stale (native signal) → needs-attention (wins over open findings).
  if (data.stale) {
    return {
      stepId: 'ai-review',
      status: 'needs-attention',
      detailText: openCount > 0 ? countLabel : 'Ready',
      reason: 'Outdated — review predates latest changes',
    };
  }

  // 4. Any blocking-severity finding still open → in-progress.
  const hasOpenBlocking = openFindings.some((f) => BLOCKING_SEVERITIES.has(f.severity));
  if (hasOpenBlocking) {
    return { stepId: 'ai-review', status: 'in-progress', detailText: countLabel };
  }

  // 5. Otherwise complete.
  return { stepId: 'ai-review', status: 'complete', detailText: 'No open findings' };
};

/** Submission — complete once a SUBMITTED submission exists; else in-progress with
 *  the pass rate when checks have run; else not-started. */
export const evaluateSubmission = (
  snap: StepDataSnapshot<SubmissionDomain>,
): StepEvaluation => {
  const data = snap.domainData;
  if (data === undefined || !Array.isArray(data.submissions)) return unavailable('submission');

  const hasSubmitted = data.submissions.some((s) => s?.status === 'SUBMITTED');
  if (hasSubmitted) return { stepId: 'submission', status: 'complete', detailText: 'Submitted' };

  if (data.hasReport) {
    const rate = Math.round(data.passRate ?? 0);
    return { stepId: 'submission', status: 'in-progress', detailText: `${rate}% pass rate` };
  }

  return { stepId: 'submission', status: 'not-started', detailText: 'Not started' };
};

// ─── Staleness layer (FR4 — BR2.1/BR2.2/BR2.3) ──────────────────────────────────

/**
 * Uniform re-upload staleness (BR2.1). After a step's base status is computed, if a
 * new solicitation was uploaded after the step's own work, the step flips to
 * needs-attention — counts/detail preserved (never reset). Never applied to the
 * Solicitations step itself or to native-signal steps (BR2.2). Statuses are derived
 * per pass, never persisted, so the step self-heals once its data updates past the
 * newest upload (BR2.3). If the newest-upload timestamp is absent, the layer is
 * skipped for that pass.
 */
export const applyReuploadStaleness = (
  evaluation: StepEvaluation,
  opts: { latestTimestamp?: string; newestUploadTimestamp?: string },
): StepEvaluation => {
  if (evaluation.stepId === 'solicitations') return evaluation;
  if (NATIVE_STALE_STEPS.has(evaluation.stepId)) return evaluation;
  if (evaluation.status !== 'in-progress' && evaluation.status !== 'complete') return evaluation;

  const { latestTimestamp, newestUploadTimestamp } = opts;
  if (!newestUploadTimestamp || !latestTimestamp) return evaluation;

  const stepMs = Date.parse(latestTimestamp);
  const uploadMs = Date.parse(newestUploadTimestamp);
  if (Number.isNaN(stepMs) || Number.isNaN(uploadMs)) return evaluation;

  if (stepMs < uploadMs) {
    return { ...evaluation, status: 'needs-attention', reason: REUPLOAD_STALE_REASON };
  }
  return evaluation;
};
