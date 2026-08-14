jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/helpers/env', () => ({ requireEnv: (_k: string, d?: string) => d ?? 'test' }));

const mockRunPropose = jest.fn();
jest.mock('@/helpers/package-edit-engine', () => ({ runProposeEdits: (...a: unknown[]) => mockRunPropose(...a) }));

const mockGetRunById = jest.fn();
const mockMarkProposed = jest.fn();
const mockMarkFailed = jest.fn();
jest.mock('@/helpers/package-edit', () => ({
  getProposalRunById: (...a: unknown[]) => mockGetRunById(...a),
  markRunProposed: (...a: unknown[]) => mockMarkProposed(...a),
  markRunFailed: (...a: unknown[]) => mockMarkFailed(...a),
}));

const mockAudit = jest.fn();
jest.mock('@/helpers/package-edit-audit', () => ({ writePackageEditAuditLog: (...a: unknown[]) => mockAudit(...a) }));

import { handler } from './propose-worker';

const job = { orgId: 'o', projectId: 'p', oppId: 'opp', runId: 'run-1' };
const sqsEvent = (body: unknown) => ({ Records: [{ body: JSON.stringify(body) }] }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRunById.mockResolvedValue({ runId: 'run-1', status: 'PROPOSING', instruction: 'do it' });
  mockRunPropose.mockResolvedValue({ answer: '', proposals: [{ editId: 'e1' }], unmatched: [], requested: 1 });
  mockMarkProposed.mockResolvedValue({});
  mockMarkFailed.mockResolvedValue({});
  mockAudit.mockResolvedValue(undefined);
});

describe('propose-worker', () => {
  it('drops a malformed job without throwing', async () => {
    await expect(handler(sqsEvent({ bad: true }), {} as never, () => {})).resolves.toBeUndefined();
    expect(mockRunPropose).not.toHaveBeenCalled();
  });

  it('drops a non-JSON body without throwing (poison message, not re-driven)', async () => {
    // Raw non-JSON body: JSON.parse must be guarded so it drops rather than
    // throwing out of the handler and re-driving/DLQing the poison message.
    const badEvent = { Records: [{ body: 'not json at all' }] } as never;
    await expect(handler(badEvent, {} as never, () => {})).resolves.toBeUndefined();
    expect(mockRunPropose).not.toHaveBeenCalled();
    expect(mockGetRunById).not.toHaveBeenCalled();
  });

  it('skips when the run is not found', async () => {
    mockGetRunById.mockResolvedValueOnce(null);
    await handler(sqsEvent(job), {} as never, () => {});
    expect(mockRunPropose).not.toHaveBeenCalled();
  });

  it('is idempotent: skips a run that is no longer PROPOSING', async () => {
    mockGetRunById.mockResolvedValueOnce({ runId: 'run-1', status: 'PROPOSED' });
    await handler(sqsEvent(job), {} as never, () => {});
    expect(mockRunPropose).not.toHaveBeenCalled();
    expect(mockMarkProposed).not.toHaveBeenCalled();
  });

  it('marks the run PROPOSED with proposals on success', async () => {
    await handler(sqsEvent(job), {} as never, () => {});
    expect(mockMarkProposed).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      [{ editId: 'e1' }],
      undefined, // no summary when proposals exist
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PACKAGE_EDIT_PROPOSAL_COMPLETED' }),
    );
  });

  it('records a truthful summary when the value was not found (0 proposals, unmatched)', async () => {
    mockRunPropose.mockResolvedValueOnce({
      answer: '',
      proposals: [],
      unmatched: ['old@x.com'],
      requested: 1,
    });
    await handler(sqsEvent(job), {} as never, () => {});
    const [, proposalsArg, summaryArg] = mockMarkProposed.mock.calls[0];
    expect(proposalsArg).toEqual([]);
    expect(summaryArg).toContain('old@x.com');
    expect(summaryArg).toMatch(/couldn't find/i);
  });

  it('marks the run FAILED and re-throws on error (DLQ visibility)', async () => {
    mockRunPropose.mockRejectedValueOnce(new Error('sonnet boom'));
    await expect(handler(sqsEvent(job), {} as never, () => {})).rejects.toThrow('sonnet boom');
    expect(mockMarkFailed).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }), 'sonnet boom');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PACKAGE_EDIT_PROPOSAL_FAILED', result: 'failure' }),
    );
  });
});
