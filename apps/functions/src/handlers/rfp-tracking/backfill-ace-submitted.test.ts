// Mock middy + Sentry wrapper so importing the handler module is side-effect free.
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

// DB inventory query.
const mockQueryAllBySkPrefix = jest.fn();
jest.mock('@/helpers/db', () => ({
  queryAllBySkPrefix: (...args: unknown[]) => mockQueryAllBySkPrefix(...args),
}));

// ACE trigger — the backfill delegates the create/advance/skip logic to it.
const mockEnsureAce = jest.fn();
jest.mock('@/helpers/ace-stage', () => ({
  ensureAceTechnicalValidation: (...args: unknown[]) => mockEnsureAce(...args),
}));

// ACE submission bot kickoff — mocked; flag-gated + idempotent in real code.
const mockStartAceSubmission = jest.fn();
jest.mock('@/helpers/ace-submission', () => ({
  startAceSubmission: (...args: unknown[]) => mockStartAceSubmission(...args),
}));

// Required env is read at module load — set before importing the handler.
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.RFP_SYNC_ORG_ID = 'org-123';
process.env.RFP_SYNC_PROJECT_ID = 'gov-contracting';

import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { backfillAceSubmitted } from './backfill-ace-submitted';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgoIso = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

/** A stored opportunity record as queryAllBySkPrefix would return it. */
const record = (oppId: string, extra: Record<string, unknown> = {}) => ({
  partition_key: OPPORTUNITY_PK,
  sort_key: `org-123#gov-contracting#${oppId}`,
  oppId,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryAllBySkPrefix.mockResolvedValue([]);
  mockEnsureAce.mockResolvedValue('created');
  mockStartAceSubmission.mockResolvedValue('disabled');
});

describe('backfillAceSubmitted', () => {
  it('picks up last-month submitted opps without an ACE opp and creates them', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-1', { status: 'SUBMITTED', approvalStatus: 'SUBMITTED', completedAt: daysAgoIso(5) }),
      record('linear-hor-2', { status: 'SUBMITTED', approvalStatus: 'SUBMITTED', completedAt: daysAgoIso(10) }),
    ]);

    const summary = await backfillAceSubmitted();

    expect(mockEnsureAce).toHaveBeenCalledTimes(2);
    expect(mockEnsureAce).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-123', projectId: 'gov-contracting', oppId: 'linear-hor-1' }),
    );
    expect(summary).toMatchObject({ scanned: 2, created: 2, advanced: 0, skipped: 0, errors: 0 });
  });

  it('ignores submitted opps that closed outside the 30-day window', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-old', { status: 'SUBMITTED', approvalStatus: 'SUBMITTED', completedAt: daysAgoIso(45) }),
    ]);

    const summary = await backfillAceSubmitted();

    expect(mockEnsureAce).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 0, created: 0 });
  });

  it('ignores non-submitted opps', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-3', { status: 'PURSUING', approvalStatus: 'I_APPROVED', completedAt: null }),
    ]);

    const summary = await backfillAceSubmitted();

    expect(mockEnsureAce).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(0);
  });

  it('skips opps already at Technical Validation (idempotent re-run)', async () => {
    mockEnsureAce.mockResolvedValue('skipped');
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-4', {
        status: 'SUBMITTED',
        approvalStatus: 'SUBMITTED',
        completedAt: daysAgoIso(3),
        aceStage: 'Technical Validation',
        apnOpportunityId: 'O999',
      }),
    ]);

    const summary = await backfillAceSubmitted();

    expect(mockEnsureAce).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ scanned: 1, created: 0, advanced: 0, skipped: 1, errors: 0 });
  });

  it('counts an advanced outcome when a PC opp already existed', async () => {
    mockEnsureAce.mockResolvedValue('advanced');
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-5', {
        status: 'SUBMITTED',
        approvalStatus: 'SUBMITTED',
        completedAt: daysAgoIso(2),
        apnOpportunityId: 'O555',
      }),
    ]);

    const summary = await backfillAceSubmitted();

    expect(summary).toMatchObject({ scanned: 1, created: 0, advanced: 1, skipped: 0, errors: 0 });
  });

  it('tolerates ACE failures — counts them as errors without throwing', async () => {
    mockEnsureAce.mockResolvedValueOnce('error').mockResolvedValueOnce('created');
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-6', { status: 'SUBMITTED', approvalStatus: 'SUBMITTED', completedAt: daysAgoIso(1) }),
      record('linear-hor-7', { status: 'SUBMITTED', approvalStatus: 'SUBMITTED', completedAt: daysAgoIso(1) }),
    ]);

    const summary = await backfillAceSubmitted();

    expect(summary).toMatchObject({ scanned: 2, created: 1, errors: 1 });
  });

  it('honors an explicit sinceIso cutoff', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-hor-8', { status: 'SUBMITTED', approvalStatus: 'SUBMITTED', completedAt: daysAgoIso(20) }),
    ]);

    // Cutoff of 10 days ago excludes the 20-days-ago submission.
    const summary = await backfillAceSubmitted({ sinceIso: daysAgoIso(10) });

    expect(mockEnsureAce).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(0);
    expect(summary.sinceIso).toBe(daysAgoIso(10));
  });

  it('resolves oppId from the sort key when the record lacks an oppId field', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      {
        partition_key: OPPORTUNITY_PK,
        sort_key: 'org-123#gov-contracting#linear-hor-9',
        status: 'SUBMITTED',
        approvalStatus: 'SUBMITTED',
        completedAt: daysAgoIso(4),
      },
    ]);

    await backfillAceSubmitted();

    expect(mockEnsureAce).toHaveBeenCalledWith(
      expect.objectContaining({ oppId: 'linear-hor-9' }),
    );
  });
});
