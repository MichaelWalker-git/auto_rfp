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

// The poller delegates each opportunity's step to the state machine.
const mockStep = jest.fn();
const mockEnabled = jest.fn();
jest.mock('@/helpers/ace-submission', () => ({
  stepAceSubmission: (...args: unknown[]) => mockStep(...args),
  isAceSubmissionEnabled: () => mockEnabled(),
}));

// Required env is read at module load — set before importing the handler.
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.RFP_SYNC_ORG_ID = 'org-123';
process.env.RFP_SYNC_PROJECT_ID = 'gov-contracting';

import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { advanceAceSubmissions } from './advance-ace-submissions';

/** A stored opportunity record as queryAllBySkPrefix would return it. */
const record = (oppId: string, state?: string) => ({
  partition_key: OPPORTUNITY_PK,
  sort_key: `org-123#gov-contracting#${oppId}`,
  oppId,
  ...(state ? { aceSubmission: { state } } : {}),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryAllBySkPrefix.mockResolvedValue([]);
  mockEnabled.mockReturnValue(true);
  mockStep.mockResolvedValue('noop');
});

describe('advanceAceSubmissions', () => {
  it('is a no-op when the bot is disabled', async () => {
    mockEnabled.mockReturnValue(false);
    const summary = await advanceAceSubmissions();
    expect(summary.disabled).toBe(true);
    expect(mockQueryAllBySkPrefix).not.toHaveBeenCalled();
    expect(mockStep).not.toHaveBeenCalled();
  });

  it('only steps records with an active (non-terminal, non-paused) submission', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-1', 'ENGAGEMENT_PENDING'),
      record('linear-2', 'SUBMITTED'),
      record('linear-3', 'ADVANCED'), // terminal — skip
      record('linear-4', 'REJECTED'), // terminal — skip
      record('linear-5', 'FAILED'), // terminal — skip
      record('linear-6', 'ACTION_REQUIRED'), // paused — skip
      record('linear-7'), // no submission — skip
    ]);
    mockStep.mockResolvedValue('IN_REVIEW');

    const summary = await advanceAceSubmissions();

    expect(summary.inFlight).toBe(2);
    expect(mockStep).toHaveBeenCalledTimes(2);
    expect(mockStep).toHaveBeenCalledWith({ orgId: 'org-123', projectId: 'gov-contracting', oppId: 'linear-1' });
    expect(mockStep).toHaveBeenCalledWith({ orgId: 'org-123', projectId: 'gov-contracting', oppId: 'linear-2' });
  });

  it('counts a completed advance', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([record('linear-1', 'APPROVED')]);
    mockStep.mockResolvedValue('ADVANCED');

    const summary = await advanceAceSubmissions();

    expect(summary.completed).toBe(1);
    expect(summary.advanced).toBe(1);
  });

  it('counts a failed/rejected terminal step', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-1', 'ENGAGEMENT_PENDING'),
      record('linear-2', 'IN_REVIEW'),
    ]);
    mockStep.mockResolvedValueOnce('FAILED').mockResolvedValueOnce('REJECTED');

    const summary = await advanceAceSubmissions();

    expect(summary.failed).toBe(2);
  });

  it('counts progress vs waiting by comparing before/after state', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      record('linear-1', 'ENGAGED'), // → SUBMITTED (progress)
      record('linear-2', 'SUBMITTED'), // → SUBMITTED (no change → waiting)
    ]);
    mockStep.mockResolvedValueOnce('SUBMITTED').mockResolvedValueOnce('SUBMITTED');

    const summary = await advanceAceSubmissions();

    expect(summary.advanced).toBe(1);
    expect(summary.waiting).toBe(1);
  });

  it('treats a noop step as waiting', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([record('linear-1', 'SUBMITTED')]);
    mockStep.mockResolvedValue('noop');

    const summary = await advanceAceSubmissions();

    expect(summary.waiting).toBe(1);
    expect(summary.advanced).toBe(0);
  });

  it('resolves oppId from the sort key when oppId field is absent', async () => {
    mockQueryAllBySkPrefix.mockResolvedValue([
      { partition_key: OPPORTUNITY_PK, sort_key: 'org-123#gov-contracting#linear-sk', aceSubmission: { state: 'ENGAGED' } },
    ]);
    mockStep.mockResolvedValue('SUBMITTED');

    await advanceAceSubmissions();

    expect(mockStep).toHaveBeenCalledWith({ orgId: 'org-123', projectId: 'gov-contracting', oppId: 'linear-sk' });
  });
});
