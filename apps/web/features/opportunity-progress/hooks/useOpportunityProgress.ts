'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutiveBriefItem, RequiredFormsListResponse } from '@auto-rfp/core';

import { useCurrentOrganization } from '@/context/organization-context';
import { useOpportunityContext } from '@/components/opportunities/opportunity-context';
import { useQuestionFiles } from '@/lib/hooks/use-question-file';
import { useGetExecutiveBriefByProject } from '@/lib/hooks/use-executive-brief';
import { useRFPDocuments } from '@/lib/hooks/use-rfp-documents';
import { useApi, buildApiUrl } from '@/lib/hooks/api-helpers';
import { useSolutionPlan } from '@/features/solution-plan';
import { useReviewRun } from '@/features/compliance-review';
import { useComplianceReport, useSubmissionHistory } from '@/features/proposal-submission';

import { STEP_META } from '../lib/steps';
import { newestTimestamp } from '../lib/timestamps';
import { evaluateOutcomeStatus, type OutcomeEvaluation } from '../lib/outcome';
import {
  evaluateSolicitations,
  evaluateAnalysis,
  evaluateSolutionPlan,
  evaluateRequiredForms,
  evaluateRfpDocuments,
  evaluateAiReview,
  evaluateSubmission,
  applyReuploadStaleness,
} from '../lib/rules';
import type {
  ProgressStep,
  StepEvaluation,
  StepDataSnapshot,
  StepDomainData,
  StepId,
  NavigationDescriptor,
  SolicitationsDomain,
  AnalysisDomain,
  SolutionPlanDomain,
  RequiredFormsDomain,
  RfpDocumentsDomain,
  AiReviewDomain,
  SubmissionDomain,
} from '../lib/types';

/** Per-step snapshot map — each step carries its own domain slice type so the
 *  strongly-typed rule evaluators receive exactly the shape they expect. */
interface StepSnapshots {
  solicitations: StepDataSnapshot<SolicitationsDomain>;
  analysis: StepDataSnapshot<AnalysisDomain>;
  'solution-plan': StepDataSnapshot<SolutionPlanDomain>;
  'required-forms': StepDataSnapshot<RequiredFormsDomain>;
  'rfp-documents': StepDataSnapshot<RfpDocumentsDomain>;
  'ai-review': StepDataSnapshot<AiReviewDomain>;
  submission: StepDataSnapshot<SubmissionDomain>;
}

interface UseOpportunityProgressResult {
  steps: ProgressStep[];
  isLoading: boolean;
  /** Post-award disposition label for the Outcome tab header (ticket 05). Not one
   *  of the seven completeness steps — a status label, never an "X of Y" metric. */
  outcome: OutcomeEvaluation;
}

/** Wrap a rule call so a single failing rule/slice degrades only that step to
 *  `unavailable` — the rules already never throw, this is defence in depth (BR3.1). */
const safeEvaluate = (
  stepId: StepId,
  run: () => StepEvaluation,
): StepEvaluation => {
  try {
    return run();
  } catch {
    return { stepId, status: 'unavailable', detailText: 'Status unavailable' };
  }
};

/**
 * ProgressAssembly (ADR-001). Decides the visible step set (org gating + forms
 * presence), gathers each step's slice from the existing data hooks, pre-computes
 * each snapshot's `latestTimestamp`, invokes the pure rules + the re-upload
 * staleness layer, and returns the ordered visible `ProgressStep[]`.
 */
export const useOpportunityProgress = (): UseOpportunityProgressResult => {
  const { currentOrganization } = useCurrentOrganization();
  const { projectId, oppId, orgId, opportunity } = useOpportunityContext();

  const solutionPlanEnabled = !!currentOrganization?.enableSolutionPlan;
  const complianceReviewEnabled = !!currentOrganization?.enableComplianceReview;

  // ── Solicitations ────────────────────────────────────────────────────────
  const {
    items: solicitationFiles,
    isLoading: isLoadingSolicitations,
    isError: solicitationsError,
  } = useQuestionFiles(projectId, { oppId });

  // ── Analysis (brief is a mutation-trigger + local state, not a shared read) ─
  const briefHook = useGetExecutiveBriefByProject(orgId || undefined);
  const [brief, setBrief] = useState<ExecutiveBriefItem | null>(null);
  const [briefFailed, setBriefFailed] = useState(false);
  const [briefLoaded, setBriefLoaded] = useState(false);
  const triggerBriefRef = useRef(briefHook.trigger);
  triggerBriefRef.current = briefHook.trigger;

  useEffect(() => {
    if (!orgId || !projectId || !oppId) return;
    let cancelled = false;
    const fetchBrief = async () => {
      try {
        const resp = await triggerBriefRef.current({ projectId, opportunityId: oppId });
        if (cancelled) return;
        setBrief(resp?.brief ?? null);
        setBriefFailed(false);
        setBriefLoaded(true);
      } catch {
        if (cancelled) return;
        setBriefFailed(true);
        setBriefLoaded(true);
      }
    };
    fetchBrief();
    const intervalId = setInterval(fetchBrief, 30_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [orgId, projectId, oppId]);

  // ── Solution Plan (native isStale) — gated off when the feature is disabled ─
  const { plan: solutionPlan, error: solutionPlanError } = useSolutionPlan(
    solutionPlanEnabled ? orgId : undefined,
    solutionPlanEnabled ? projectId : undefined,
    solutionPlanEnabled ? oppId : undefined,
  );

  // ── Required Forms (same key as RequiredFormsList → SWR-deduped) ────────────
  const formsUrl =
    orgId && projectId && oppId
      ? buildApiUrl('/required-forms/list', { orgId, projectId, opportunityId: oppId })
      : null;
  const {
    data: formsData,
    isError: formsError,
  } = useApi<RequiredFormsListResponse>(formsUrl, formsUrl ?? undefined, {
    refreshInterval: 10_000,
    dedupingInterval: 5_000,
  });
  const requiredForms = formsData?.forms ?? [];

  // ── RFP Documents ───────────────────────────────────────────────────────────
  const {
    documents: rfpDocuments,
    isError: rfpDocumentsError,
  } = useRFPDocuments(projectId, orgId || null, oppId);

  // ── AI Review (native stale) — gated off when disabled ──────────────────────
  const {
    run: reviewRun,
    findings: reviewFindings,
    decisions: reviewDecisions,
    stale: reviewStale,
    error: reviewError,
  } = useReviewRun(
    complianceReviewEnabled ? orgId : undefined,
    complianceReviewEnabled ? projectId : undefined,
    complianceReviewEnabled ? oppId : undefined,
  );

  // ── Submission (pass rate from the report + submission history) ─────────────
  const {
    report: complianceReport,
    passRate,
    error: reportError,
  } = useComplianceReport(orgId || undefined, projectId, oppId);
  // "Checks have run" = a compliance report exists (carries generatedAt/passRate),
  // distinct from `isReady` which means the package passes and can be submitted.
  const hasReport = !!complianceReport;
  const {
    submissions,
    error: submissionsError,
  } = useSubmissionHistory(orgId || undefined, projectId, oppId);

  // ── Newest solicitation upload (staleness comparison basis) ─────────────────
  // Keyed on `createdAt` (the upload event) ONLY — a solicitation file's
  // `updatedAt` is bumped by the downstream pipeline (e.g. mark-forms-ready sets
  // FORMS_READY + updatedAt late in processing), so using it would flip every
  // downstream step to "needs attention" on a normal run even with no re-upload.
  const newestUploadTimestamp = useMemo(
    () =>
      newestTimestamp(
        solicitationFiles
          .filter((f) => f.status !== 'DELETED')
          .map((f) => f.createdAt),
      ),
    [solicitationFiles],
  );

  const steps = useMemo<ProgressStep[]>(() => {
    // Build one snapshot per step: the domain slice (undefined on fetch error →
    // `unavailable`) plus a pre-computed newest timestamp for the staleness layer.
    const snapshots: StepSnapshots = {
      solicitations: {
        stepId: 'solicitations',
        domainData: solicitationsError ? undefined : { files: solicitationFiles },
        latestTimestamp: newestUploadTimestamp,
      },
      analysis: {
        stepId: 'analysis',
        domainData: briefFailed ? undefined : { brief },
        latestTimestamp: newestTimestamp([
          brief?.updatedAt,
          ...(brief?.sections
            ? Object.values(brief.sections).map((s) => s?.updatedAt ?? undefined)
            : []),
        ]),
      },
      'solution-plan': {
        stepId: 'solution-plan',
        domainData: solutionPlanError ? undefined : { plan: solutionPlan },
        latestTimestamp: solutionPlan?.updatedAt ?? undefined,
      },
      'required-forms': {
        stepId: 'required-forms',
        domainData: formsError ? undefined : { forms: requiredForms },
        latestTimestamp: newestTimestamp(
          requiredForms.flatMap((f) => [f.updatedAt, f.createdAt]),
        ),
      },
      'rfp-documents': {
        stepId: 'rfp-documents',
        domainData: rfpDocumentsError
          ? undefined
          : {
              documents: rfpDocuments,
              requiredDocuments:
                brief?.sections?.requirements?.data?.submissionCompliance?.requiredDocuments ??
                undefined,
            },
        latestTimestamp: newestTimestamp(
          rfpDocuments.flatMap((d) => [d.updatedAt, d.createdAt]),
        ),
      },
      'ai-review': {
        stepId: 'ai-review',
        domainData: reviewError
          ? undefined
          : {
              run: reviewRun,
              findings: reviewFindings,
              decisions: reviewDecisions,
              stale: reviewStale,
            },
        latestTimestamp: undefined, // native-signal step — BR2.1 never applies
      },
      submission: {
        stepId: 'submission',
        domainData:
          submissionsError && reportError
            ? undefined
            : { submissions, passRate, hasReport },
        latestTimestamp: newestTimestamp([
          complianceReport?.generatedAt,
          ...submissions.flatMap((s) => [s.submittedAt, s.updatedAt]),
        ]),
      },
    };

    const evaluators: Record<StepId, () => StepEvaluation> = {
      solicitations: () => evaluateSolicitations(snapshots.solicitations),
      analysis: () => evaluateAnalysis(snapshots.analysis),
      'solution-plan': () => evaluateSolutionPlan(snapshots['solution-plan']),
      'required-forms': () => evaluateRequiredForms(snapshots['required-forms']),
      'rfp-documents': () => evaluateRfpDocuments(snapshots['rfp-documents']),
      'ai-review': () => evaluateAiReview(snapshots['ai-review']),
      submission: () => evaluateSubmission(snapshots.submission),
    };

    // Visibility (FR1.5/FR1.6): org gating + Required Forms hidden when none detected.
    const isVisible = (stepId: StepId): boolean => {
      if (stepId === 'solution-plan') return solutionPlanEnabled;
      if (stepId === 'ai-review') return complianceReviewEnabled;
      if (stepId === 'required-forms') return requiredForms.length > 0;
      return true;
    };

    return STEP_META.filter((meta) => isVisible(meta.id)).map((meta) => {
      const snapshot = snapshots[meta.id];
      const base = safeEvaluate(meta.id, evaluators[meta.id]);
      const evaluation = applyReuploadStaleness(base, {
        latestTimestamp: snapshot.latestTimestamp,
        newestUploadTimestamp,
      });
      const navigation: NavigationDescriptor = { kind: 'route', href: meta.tabKey };
      return {
        ...evaluation,
        label: meta.label,
        navigation,
        visible: true,
        domainData: snapshot.domainData as StepDomainData | undefined,
      };
    });
  }, [
    solicitationFiles,
    solicitationsError,
    brief,
    briefFailed,
    solutionPlan,
    solutionPlanError,
    solutionPlanEnabled,
    requiredForms,
    formsError,
    rfpDocuments,
    rfpDocumentsError,
    reviewRun,
    reviewFindings,
    reviewDecisions,
    reviewStale,
    reviewError,
    complianceReviewEnabled,
    submissions,
    submissionsError,
    passRate,
    hasReport,
    complianceReport,
    reportError,
    newestUploadTimestamp,
  ]);

  // First paint shows a skeleton until the primary (Solicitations) data resolves
  // and the brief's initial fetch settles; other steps fill in as their data lands.
  // The brief gate matches the exact triad its effect requires — otherwise a
  // present orgId with a momentarily-undefined projectId/oppId (the effect
  // early-returns without ever setting briefLoaded) would latch the skeleton forever.
  const isLoading =
    isLoadingSolicitations || (!!orgId && !!projectId && !!oppId && !briefLoaded);

  const outcome = evaluateOutcomeStatus(opportunity?.status);

  return { steps, isLoading, outcome };
};
