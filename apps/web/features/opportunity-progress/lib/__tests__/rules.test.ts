import type {
  ComplianceFinding,
  FindingDecision,
} from '@auto-rfp/core';
import {
  evaluateSolicitations,
  evaluateAnalysis,
  evaluateSolutionPlan,
  evaluateRequiredForms,
  evaluateRfpDocuments,
  evaluateAiReview,
  evaluateSubmission,
  applyReuploadStaleness,
  REUPLOAD_STALE_REASON,
  ANALYSIS_SECTION_KEYS,
} from '../rules';
import type {
  StepDataSnapshot,
  SolicitationsDomain,
  AnalysisDomain,
  SolutionPlanDomain,
  RequiredFormsDomain,
  RfpDocumentsDomain,
  AiReviewDomain,
  SubmissionDomain,
  StepEvaluation,
  StepId,
} from '../types';

// ─── Snapshot factories ─────────────────────────────────────────────────────────

const snap = <D>(stepId: StepId, domainData?: D, latestTimestamp?: string): StepDataSnapshot<D> =>
  ({ stepId, domainData, latestTimestamp }) as StepDataSnapshot<D>;

const finding = (fingerprint: string, severity: string): ComplianceFinding =>
  ({ fingerprint, severity }) as unknown as ComplianceFinding;

const decision = (fingerprint: string, state: string): FindingDecision =>
  ({ fingerprint, state }) as unknown as FindingDecision;

describe('evaluateSolicitations', () => {
  it('unavailable when the slice is missing', () => {
    expect(evaluateSolicitations(snap<SolicitationsDomain>('solicitations')).status).toBe(
      'unavailable',
    );
  });

  it('not-started with zero non-deleted files', () => {
    const result = evaluateSolicitations(
      snap<SolicitationsDomain>('solicitations', {
        files: [{ status: 'DELETED', createdAt: 'a', updatedAt: 'a' }],
      }),
    );
    expect(result.status).toBe('not-started');
    expect(result.detailText).toBe('0 of 0 processed');
  });

  it('in-progress when some files are still processing', () => {
    const result = evaluateSolicitations(
      snap<SolicitationsDomain>('solicitations', {
        files: [
          { status: 'PROCESSED', createdAt: 'a', updatedAt: 'a' },
          { status: 'UPLOADED', createdAt: 'a', updatedAt: 'a' },
        ],
      }),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('1 of 2 processed');
  });

  it('needs-attention when a non-deleted file failed or was cancelled', () => {
    const result = evaluateSolicitations(
      snap<SolicitationsDomain>('solicitations', {
        files: [
          { status: 'PROCESSED', createdAt: 'a', updatedAt: 'a' },
          { status: 'FAILED', createdAt: 'a', updatedAt: 'a' },
        ],
      }),
    );
    expect(result.status).toBe('needs-attention');
    expect(result.detailText).toBe('1 of 2 processed');
    expect(result.reason).toBeDefined();
  });

  it('complete only when every non-deleted file is fully processed', () => {
    const result = evaluateSolicitations(
      snap<SolicitationsDomain>('solicitations', {
        files: [
          { status: 'PROCESSED', createdAt: 'a', updatedAt: 'a' },
          { status: 'FORMS_READY', createdAt: 'a', updatedAt: 'a' },
          { status: 'DELETED', createdAt: 'a', updatedAt: 'a' },
        ],
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('2 of 2 processed');
  });
});

describe('evaluateAnalysis', () => {
  const sectionsAll = (status: 'COMPLETE' | 'PENDING') =>
    Object.fromEntries(ANALYSIS_SECTION_KEYS.map((k) => [k, { status }]));

  it('unavailable when the slice is missing', () => {
    expect(evaluateAnalysis(snap<AnalysisDomain>('analysis')).status).toBe('unavailable');
  });

  it('not-started with no brief', () => {
    const result = evaluateAnalysis(snap<AnalysisDomain>('analysis', { brief: null }));
    expect(result.status).toBe('not-started');
    expect(result.detailText).toBe('0 of 8 sections');
  });

  it('in-progress when not all sections complete', () => {
    const sections = { ...sectionsAll('PENDING'), summary: { status: 'COMPLETE' } };
    const result = evaluateAnalysis(
      snap<AnalysisDomain>('analysis', { brief: { sections } as AnalysisDomain['brief'] }),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('1 of 8 sections');
  });

  it('complete when all 8 sections complete', () => {
    const result = evaluateAnalysis(
      snap<AnalysisDomain>('analysis', {
        brief: { sections: sectionsAll('COMPLETE') } as AnalysisDomain['brief'],
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('8 of 8 sections');
  });
});

describe('evaluateSolutionPlan', () => {
  it('unavailable when the slice is missing', () => {
    expect(evaluateSolutionPlan(snap<SolutionPlanDomain>('solution-plan')).status).toBe(
      'unavailable',
    );
  });

  it('not-started with no plan', () => {
    expect(
      evaluateSolutionPlan(snap<SolutionPlanDomain>('solution-plan', { plan: null })).status,
    ).toBe('not-started');
  });

  it('in-progress while generating', () => {
    const result = evaluateSolutionPlan(
      snap<SolutionPlanDomain>('solution-plan', {
        plan: { status: 'GENERATING_SOT' } as SolutionPlanDomain['plan'],
      }),
    );
    expect(result.status).toBe('in-progress');
  });

  it('complete when READY and not stale', () => {
    const result = evaluateSolutionPlan(
      snap<SolutionPlanDomain>('solution-plan', {
        plan: { status: 'READY', isStale: false } as SolutionPlanDomain['plan'],
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('Ready');
  });

  it('needs-attention (native) when READY but isStale — detail preserved', () => {
    const result = evaluateSolutionPlan(
      snap<SolutionPlanDomain>('solution-plan', {
        plan: {
          status: 'READY',
          isStale: true,
          staleReason: 'Solicitation changed',
        } as SolutionPlanDomain['plan'],
      }),
    );
    expect(result.status).toBe('needs-attention');
    expect(result.detailText).toBe('Ready');
    expect(result.reason).toBe('Solicitation changed');
  });

  it('needs-attention when FAILED', () => {
    const result = evaluateSolutionPlan(
      snap<SolutionPlanDomain>('solution-plan', {
        plan: { status: 'FAILED' } as SolutionPlanDomain['plan'],
      }),
    );
    expect(result.status).toBe('needs-attention');
  });
});

describe('evaluateRequiredForms', () => {
  // `filled` = how many of the `total` fields carry a value; the rest are EMPTY.
  const form = (total: number, filled: number, name = 'F') => ({
    name,
    status: 'PENDING',
    totalFieldCount: total,
    manualFieldCount: 0,
    fields: Array.from({ length: total }, (_, i) => ({
      fieldId: `${name}-${i}`,
      value: i < filled ? 'x' : null,
    })),
    createdAt: 'a',
    updatedAt: 'a',
  });

  it('unavailable when the slice is missing', () => {
    expect(evaluateRequiredForms(snap<RequiredFormsDomain>('required-forms')).status).toBe(
      'unavailable',
    );
  });

  it('not-started with no forms', () => {
    expect(
      evaluateRequiredForms(snap<RequiredFormsDomain>('required-forms', { forms: [] })).status,
    ).toBe('not-started');
  });

  it('in-progress when some forms still need fields', () => {
    const result = evaluateRequiredForms(
      snap<RequiredFormsDomain>('required-forms', {
        forms: [form(3, 3, 'a'), form(2, 1, 'b')],
      }),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('1 of 2 filled');
  });

  it('complete when every form is fully filled', () => {
    const result = evaluateRequiredForms(
      snap<RequiredFormsDomain>('required-forms', {
        forms: [form(3, 3, 'a'), form(2, 2, 'b')],
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('2 of 2 filled');
  });

  it('complete when all fields carry a value even if manualFieldCount > 0', () => {
    // The MANUAL_REQUIRED "needs review" flag has no clearing mechanism, so a
    // filled manual field keeps manualFieldCount > 0 — the form must still count
    // as filled once every field has a value.
    const result = evaluateRequiredForms(
      snap<RequiredFormsDomain>('required-forms', {
        forms: [
          {
            name: 'a',
            status: 'PENDING',
            totalFieldCount: 2,
            manualFieldCount: 2,
            fields: [
              { fieldId: 'a-0', value: 'typed', status: 'MANUAL_REQUIRED' },
              { fieldId: 'a-1', value: 'typed', status: 'MANUAL_REQUIRED' },
            ],
            createdAt: 'a',
            updatedAt: 'a',
          } as unknown as RequiredFormsDomain['forms'][number],
        ],
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('1 of 1 filled');
  });

  it('counts a stamped checkbox (markChar, no value) as filled', () => {
    const result = evaluateRequiredForms(
      snap<RequiredFormsDomain>('required-forms', {
        forms: [
          {
            name: 'a',
            status: 'PENDING',
            totalFieldCount: 1,
            manualFieldCount: 0,
            fields: [{ fieldId: 'a-0', value: null, markChar: '☒' }],
            createdAt: 'a',
            updatedAt: 'a',
          } as unknown as RequiredFormsDomain['forms'][number],
        ],
      }),
    );
    expect(result.status).toBe('complete');
  });
});

describe('evaluateRfpDocuments', () => {
  const doc = (documentType: string, status: string) =>
    ({ name: documentType, title: documentType, documentType, status, createdAt: 'a', updatedAt: 'a' }) as RfpDocumentsDomain['documents'][number];

  it('unavailable when the slice is missing', () => {
    expect(evaluateRfpDocuments(snap<RfpDocumentsDomain>('rfp-documents')).status).toBe(
      'unavailable',
    );
  });

  it('primary path counts against the required-documents list', () => {
    const result = evaluateRfpDocuments(
      snap<RfpDocumentsDomain>('rfp-documents', {
        documents: [doc('TECHNICAL', 'READY'), doc('PRICE', 'DRAFT')],
        requiredDocuments: [
          { documentType: 'TECHNICAL', name: 'Tech' },
          { documentType: 'PRICE', name: 'Price' },
        ] as RfpDocumentsDomain['requiredDocuments'],
      }),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('1 of 2 required');
  });

  it('primary path complete when all required types are ready', () => {
    const result = evaluateRfpDocuments(
      snap<RfpDocumentsDomain>('rfp-documents', {
        documents: [doc('TECHNICAL', 'APPROVED')],
        requiredDocuments: [
          { documentType: 'TECHNICAL', name: 'Tech' },
        ] as RfpDocumentsDomain['requiredDocuments'],
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('1 of 1 required');
  });

  it('excludes optional (required: false) documents from the required total', () => {
    const result = evaluateRfpDocuments(
      snap<RfpDocumentsDomain>('rfp-documents', {
        documents: [doc('TECHNICAL', 'READY')],
        requiredDocuments: [
          { documentType: 'TECHNICAL', name: 'Tech', required: true },
          { documentType: 'ATTACHMENT', name: 'Optional attachment', required: false },
        ] as RfpDocumentsDomain['requiredDocuments'],
      }),
    );
    // only the one mandatory doc counts → complete, not "1 of 2"
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('1 of 1 required');
  });

  it('fallback path counts ready over existing documents', () => {
    const result = evaluateRfpDocuments(
      snap<RfpDocumentsDomain>('rfp-documents', {
        documents: [doc('A', 'READY'), doc('B', 'DRAFT')],
      }),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('1 of 2 ready');
  });

  it('fallback not-started with no documents', () => {
    expect(
      evaluateRfpDocuments(snap<RfpDocumentsDomain>('rfp-documents', { documents: [] })).status,
    ).toBe('not-started');
  });
});

describe('evaluateAiReview', () => {
  const base = (over: Partial<AiReviewDomain>): AiReviewDomain => ({
    run: { status: 'READY' } as AiReviewDomain['run'],
    findings: [],
    decisions: [],
    stale: false,
    ...over,
  });

  it('unavailable when arrays are missing', () => {
    expect(evaluateAiReview(snap<AiReviewDomain>('ai-review')).status).toBe('unavailable');
  });

  it('not-started with no run', () => {
    expect(
      evaluateAiReview(snap<AiReviewDomain>('ai-review', base({ run: null }))).status,
    ).toBe('not-started');
  });

  it('in-progress while running', () => {
    expect(
      evaluateAiReview(
        snap<AiReviewDomain>('ai-review', base({ run: { status: 'RUNNING' } as AiReviewDomain['run'] })),
      ).status,
    ).toBe('in-progress');
  });

  it('needs-attention when the latest run FAILED', () => {
    const result = evaluateAiReview(
      snap<AiReviewDomain>('ai-review', base({ run: { status: 'FAILED' } as AiReviewDomain['run'] })),
    );
    expect(result.status).toBe('needs-attention');
    expect(result.detailText).toBe('Failed');
  });

  it('native stale wins over open findings', () => {
    const result = evaluateAiReview(
      snap<AiReviewDomain>(
        'ai-review',
        base({ stale: true, findings: [finding('f1', 'critical')] }),
      ),
    );
    expect(result.status).toBe('needs-attention');
    expect(result.detailText).toBe('1 open finding');
  });

  it('in-progress when an open blocking finding exists', () => {
    const result = evaluateAiReview(
      snap<AiReviewDomain>('ai-review', base({ findings: [finding('f1', 'major')] })),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('1 open finding');
  });

  it('complete when blocking findings are all resolved', () => {
    const result = evaluateAiReview(
      snap<AiReviewDomain>(
        'ai-review',
        base({
          findings: [finding('f1', 'critical')],
          decisions: [decision('f1', 'resolved')],
        }),
      ),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('No open findings');
  });
});

describe('evaluateSubmission', () => {
  it('unavailable when submissions array is missing', () => {
    expect(evaluateSubmission(snap<SubmissionDomain>('submission')).status).toBe('unavailable');
  });

  it('not-started when no report and no submission', () => {
    expect(
      evaluateSubmission(
        snap<SubmissionDomain>('submission', { submissions: [], hasReport: false }),
      ).status,
    ).toBe('not-started');
  });

  it('in-progress with pass rate when checks have run', () => {
    const result = evaluateSubmission(
      snap<SubmissionDomain>('submission', {
        submissions: [],
        hasReport: true,
        passRate: 82.4,
      }),
    );
    expect(result.status).toBe('in-progress');
    expect(result.detailText).toBe('82% pass rate');
  });

  it('complete once a SUBMITTED submission exists', () => {
    const result = evaluateSubmission(
      snap<SubmissionDomain>('submission', {
        submissions: [{ status: 'SUBMITTED' } as SubmissionDomain['submissions'][number]],
        hasReport: true,
      }),
    );
    expect(result.status).toBe('complete');
    expect(result.detailText).toBe('Submitted');
  });
});

describe('applyReuploadStaleness (BR2.1/2.2/2.3)', () => {
  const evalOf = (stepId: StepId, status: StepEvaluation['status']): StepEvaluation => ({
    stepId,
    status,
    detailText: '2 of 3 filled',
  });

  it('flips an outdated in-progress/complete step to needs-attention, preserving detail', () => {
    const result = applyReuploadStaleness(evalOf('required-forms', 'complete'), {
      latestTimestamp: '2026-01-01T00:00:00Z',
      newestUploadTimestamp: '2026-02-01T00:00:00Z',
    });
    expect(result.status).toBe('needs-attention');
    expect(result.detailText).toBe('2 of 3 filled');
    expect(result.reason).toBe(REUPLOAD_STALE_REASON);
  });

  it('leaves a step untouched when its work postdates the newest upload', () => {
    const result = applyReuploadStaleness(evalOf('required-forms', 'complete'), {
      latestTimestamp: '2026-03-01T00:00:00Z',
      newestUploadTimestamp: '2026-02-01T00:00:00Z',
    });
    expect(result.status).toBe('complete');
  });

  it('never applies to the Solicitations step itself', () => {
    const result = applyReuploadStaleness(evalOf('solicitations', 'complete'), {
      latestTimestamp: '2026-01-01T00:00:00Z',
      newestUploadTimestamp: '2026-02-01T00:00:00Z',
    });
    expect(result.status).toBe('complete');
  });

  it('never applies to native-signal steps (BR2.2)', () => {
    for (const stepId of ['solution-plan', 'ai-review'] as const) {
      const result = applyReuploadStaleness(evalOf(stepId, 'complete'), {
        latestTimestamp: '2026-01-01T00:00:00Z',
        newestUploadTimestamp: '2026-02-01T00:00:00Z',
      });
      expect(result.status).toBe('complete');
    }
  });

  it('does not touch not-started / needs-attention / unavailable base statuses', () => {
    for (const status of ['not-started', 'needs-attention', 'unavailable'] as const) {
      const result = applyReuploadStaleness(evalOf('required-forms', status), {
        latestTimestamp: '2026-01-01T00:00:00Z',
        newestUploadTimestamp: '2026-02-01T00:00:00Z',
      });
      expect(result.status).toBe(status);
    }
  });

  it('skips the pass when timestamps are absent or unparseable (BR3.1)', () => {
    expect(
      applyReuploadStaleness(evalOf('required-forms', 'complete'), {
        newestUploadTimestamp: '2026-02-01T00:00:00Z',
      }).status,
    ).toBe('complete');
    expect(
      applyReuploadStaleness(evalOf('required-forms', 'complete'), {
        latestTimestamp: 'not-a-date',
        newestUploadTimestamp: '2026-02-01T00:00:00Z',
      }).status,
    ).toBe('complete');
  });
});
