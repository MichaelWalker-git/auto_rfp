import type {
  QuestionFileItem,
  ExecutiveBriefItem,
  SolutionPlanItem,
  RequiredFormItem,
  RFPDocumentItem,
  ComplianceReviewRun,
  ComplianceFinding,
  FindingDecision,
  ProposalSubmissionItem,
  RequiredOutputDocument,
} from '@auto-rfp/core';

// ─── Enumerations (string unions — no TS enums, house rule) ────────────────────

/** Ordered ids of the package-preparation flow. Additive: a future `questions`
 *  step slots in without a redesign (ADR-004). */
export const STEP_IDS = [
  'solicitations',
  'analysis',
  'solution-plan',
  'required-forms',
  'rfp-documents',
  'ai-review',
  'submission',
] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The four semantic statuses plus `unavailable` — a degraded *display* for an
 *  uncomputable step (BR3.1), not a fifth semantic status. */
export const STEP_STATUSES = [
  'not-started',
  'in-progress',
  'complete',
  'needs-attention',
  'unavailable',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

// ─── Navigation (FR3, ADR-004) ─────────────────────────────────────────────────

/** A generic navigation action. Today every step is an `anchor` (smooth-scroll to
 *  a page section); the `route` variant lets a future step target another page. */
export type NavigationDescriptor =
  | { kind: 'anchor'; sectionId: string }
  | { kind: 'route'; href: string };

// ─── Per-step domain slices ────────────────────────────────────────────────────
// Only the fields the rules / details popover read, `Pick`ed from the existing
// `@auto-rfp/core` domain item types so the rules stay coupled to the real shapes.

export type SolicitationFileData = Pick<
  QuestionFileItem,
  'status' | 'createdAt' | 'updatedAt'
>;
export interface SolicitationsDomain {
  files: SolicitationFileData[];
}

export interface AnalysisDomain {
  brief: Pick<ExecutiveBriefItem, 'sections' | 'updatedAt'> | null;
}

export interface SolutionPlanDomain {
  plan:
    | Pick<SolutionPlanItem, 'status' | 'isStale' | 'staleReason' | 'updatedAt'>
    | null;
}

export type RequiredFormData = Pick<
  RequiredFormItem,
  'name' | 'status' | 'totalFieldCount' | 'manualFieldCount' | 'fields' | 'createdAt' | 'updatedAt'
>;
export interface RequiredFormsDomain {
  forms: RequiredFormData[];
}

export type RfpDocumentData = Pick<
  RFPDocumentItem,
  'name' | 'title' | 'documentType' | 'status' | 'createdAt' | 'updatedAt'
>;
export interface RfpDocumentsDomain {
  documents: RfpDocumentData[];
  /** The brief's required-documents list, when the requirements section carries one. */
  requiredDocuments?: RequiredOutputDocument[];
}

export interface AiReviewDomain {
  run: Pick<ComplianceReviewRun, 'status'> | null;
  findings: ComplianceFinding[];
  decisions: FindingDecision[];
  /** Native server-computed run-level staleness (do not recompute — BR2.2). */
  stale: boolean;
}

export interface SubmissionDomain {
  submissions: Pick<ProposalSubmissionItem, 'status' | 'submittedAt' | 'updatedAt'>[];
  /** Compliance pass rate (0-100) from the sibling report; undefined if no report. */
  passRate?: number;
  /** Whether a compliance report has been generated (checks have run). */
  hasReport: boolean;
}

/** Union of the per-step domain slices, for the details popover's narrowing. */
export type StepDomainData =
  | SolicitationsDomain
  | AnalysisDomain
  | SolutionPlanDomain
  | RequiredFormsDomain
  | RfpDocumentsDomain
  | AiReviewDomain
  | SubmissionDomain;

// ─── Snapshot / evaluation / assembled step ────────────────────────────────────

export interface StepDataSnapshot<D extends StepDomainData = StepDomainData> {
  stepId: StepId;
  /** Step-specific slice of already-fetched domain data. Absent/partial is legal
   *  (BR3.1) — an absent slice degrades the step to `unavailable`, never a throw. */
  domainData?: D;
  /** Newest server timestamp within the step's data, PRE-COMPUTED by the hook (ISO). */
  latestTimestamp?: string;
}

export interface StepEvaluation {
  stepId: StepId;
  status: StepStatus;
  /** Compact count or status word, e.g. "2 of 3 filled", "Ready". */
  detailText: string;
  /** Present when needs-attention (FR4.2); optional for unavailable. */
  reason?: string;
}

/** Assembly output: a `StepEvaluation` plus presentation + navigation. */
export interface ProgressStep extends StepEvaluation {
  label: string;
  navigation: NavigationDescriptor;
  visible: boolean;
  /** The snapshot slice the counts came from, carried through for the details
   *  popover so it needs no new fetching. */
  domainData?: StepDomainData;
}
