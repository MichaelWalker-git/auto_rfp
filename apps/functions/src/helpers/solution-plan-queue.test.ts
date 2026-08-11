/**
 * Tests for the Solution Plan SQS enqueue helper (T6).
 */
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSend })),
  SendMessageCommand: jest.fn((params) => ({ type: 'SendMessage', params })),
}));

import {
  GrillingRoundMessageSchema,
  enqueueGrillingRound,
  type GrillingRoundMessage,
} from './solution-plan-queue';

const message: GrillingRoundMessage = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  solutionPlanId: 'plan-1',
  runId: 'run-1',
  round: 1,
  phase: 'GRILL',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({});
});

describe('GrillingRoundMessageSchema', () => {
  it('accepts a valid GRILL message', () => {
    const { success } = GrillingRoundMessageSchema.safeParse(message);
    expect(success).toBe(true);
  });

  it('accepts the SYNTHESIZE phase', () => {
    const { success } = GrillingRoundMessageSchema.safeParse({ ...message, phase: 'SYNTHESIZE' });
    expect(success).toBe(true);
  });

  it('rejects an unknown phase', () => {
    const { success } = GrillingRoundMessageSchema.safeParse({ ...message, phase: 'REVIEW' });
    expect(success).toBe(false);
  });

  it('rejects a non-positive round', () => {
    const { success } = GrillingRoundMessageSchema.safeParse({ ...message, round: 0 });
    expect(success).toBe(false);
  });

  it('rejects a missing runId', () => {
    const { runId: _runId, ...withoutRunId } = message;
    const { success } = GrillingRoundMessageSchema.safeParse(withoutRunId);
    expect(success).toBe(false);
  });
});

describe('enqueueGrillingRound', () => {
  it('sends the message as JSON to the solution plan queue', async () => {
    await enqueueGrillingRound(message);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0] as { params: { QueueUrl: string; MessageBody: string } };
    expect(command.params.QueueUrl).toBe(process.env.SOLUTION_PLAN_QUEUE_URL);
    expect(JSON.parse(command.params.MessageBody)).toEqual(message);
  });

  it('propagates SQS failures to the caller', async () => {
    mockSend.mockRejectedValue(new Error('SQS unavailable'));
    await expect(enqueueGrillingRound(message)).rejects.toThrow('SQS unavailable');
  });
});
