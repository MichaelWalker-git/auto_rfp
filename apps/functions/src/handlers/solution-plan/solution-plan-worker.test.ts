/**
 * Tests for the thin Solution Plan SQS handler (T6) — message validation,
 * phase dispatch, and batch-item failure reporting.
 */
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockProcessGrillingRound = jest.fn();
const mockProcessSynthesis = jest.fn();

jest.mock('@/helpers/solution-plan-worker', () => ({
  processGrillingRound: (...a: unknown[]) => mockProcessGrillingRound(...a),
  processSynthesis: (...a: unknown[]) => mockProcessSynthesis(...a),
}));

import type { SQSEvent } from 'aws-lambda';
import { baseHandler, processSolutionPlanRecord } from './solution-plan-worker';

const validMessage = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  solutionPlanId: 'plan-1',
  runId: 'run-1',
  round: 1,
  phase: 'GRILL',
};

const sqsEvent = (bodies: string[]): SQSEvent =>
  ({
    Records: bodies.map((body, i) => ({ messageId: `msg-${i}`, body })),
  }) as SQSEvent;

beforeEach(() => {
  jest.clearAllMocks();
  mockProcessGrillingRound.mockResolvedValue(undefined);
  mockProcessSynthesis.mockResolvedValue(undefined);
});

describe('processSolutionPlanRecord', () => {
  it('dispatches GRILL messages to processGrillingRound', async () => {
    await processSolutionPlanRecord(JSON.stringify(validMessage));
    expect(mockProcessGrillingRound).toHaveBeenCalledWith(validMessage);
    expect(mockProcessSynthesis).not.toHaveBeenCalled();
  });

  it('dispatches SYNTHESIZE messages to processSynthesis', async () => {
    await processSolutionPlanRecord(JSON.stringify({ ...validMessage, phase: 'SYNTHESIZE' }));
    expect(mockProcessSynthesis).toHaveBeenCalledWith({ ...validMessage, phase: 'SYNTHESIZE' });
    expect(mockProcessGrillingRound).not.toHaveBeenCalled();
  });

  it('drops non-JSON bodies without throwing (retry can never succeed)', async () => {
    await expect(processSolutionPlanRecord('not json')).resolves.toBeUndefined();
    expect(mockProcessGrillingRound).not.toHaveBeenCalled();
  });

  it('drops schema-invalid messages without throwing', async () => {
    await expect(
      processSolutionPlanRecord(JSON.stringify({ ...validMessage, round: 0 })),
    ).resolves.toBeUndefined();
    expect(mockProcessGrillingRound).not.toHaveBeenCalled();
  });
});

describe('baseHandler', () => {
  it('returns no failures when all records process', async () => {
    const result = await baseHandler(sqsEvent([JSON.stringify(validMessage)]));
    expect(result.batchItemFailures).toEqual([]);
  });

  it('reports a failed record for redelivery/DLQ', async () => {
    mockProcessGrillingRound.mockRejectedValue(new Error('round failed'));
    const result = await baseHandler(sqsEvent([JSON.stringify(validMessage)]));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });

  it('processes remaining records after one fails', async () => {
    mockProcessGrillingRound
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const result = await baseHandler(
      sqsEvent([JSON.stringify(validMessage), JSON.stringify(validMessage)]),
    );

    expect(mockProcessGrillingRound).toHaveBeenCalledTimes(2);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });
});
