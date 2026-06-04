/**
 * Tests for copy-cluster-answers resolution propagation.
 *
 * Focus: when a cluster master has no usable answer, its members must inherit
 * the master's REASON (NO_KB_MATCH / GENERATION_FAILED) instead of being left
 * as silent blanks.
 */

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

// docClient.send drives the cluster query loop
const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: mockSend },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

const mockGetAnswerForQuestion = jest.fn();
jest.mock('@/helpers/answer', () => ({
  getAnswerForQuestion: mockGetAnswerForQuestion,
}));

const mockSaveAnswer = jest.fn();
jest.mock('@/handlers/answer/save-answer', () => ({
  saveAnswer: mockSaveAnswer,
}));

// Non-blocking notification + audit chain — resolve to no-ops
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: jest.fn(() => Promise.resolve()),
  buildNotification: jest.fn(() => ({})),
}));
jest.mock('@/helpers/user', () => ({
  getOrgMembers: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/helpers/project', () => ({
  getProjectById: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn(() => Promise.resolve('secret')),
}));
jest.mock('@/helpers/date', () => ({
  nowIso: jest.fn(() => '2026-01-01T00:00:00.000Z'),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './copy-cluster-answers';

const mockContext = { awsRequestId: 'req-1' } as any;

/** A single-cluster query result, then an empty page to end the do/while loop. */
const singleCluster = (cluster: Record<string, unknown>) => {
  mockSend.mockResolvedValueOnce({ Items: [cluster], LastEvaluatedKey: undefined });
};

describe('copy-cluster-answers — resolution propagation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSaveAnswer.mockResolvedValue({ id: 'ans-saved' });
  });

  it('propagates the master NO_KB_MATCH resolution to members when the master has no text', async () => {
    singleCluster({
      clusterId: 'c-1',
      masterQuestionId: 'master-1',
      questionFileId: 'file-1',
      opportunityId: 'opp-1',
      members: [
        { questionId: 'master-1', similarity: 1 },
        { questionId: 'member-1', similarity: 0.95 },
        { questionId: 'member-2', similarity: 0.93 },
      ],
    });

    // Master answer: empty text but carries a NO_KB_MATCH resolution
    mockGetAnswerForQuestion.mockResolvedValueOnce({ text: '', resolution: 'NO_KB_MATCH' });

    const result = await baseHandler({ projectId: 'proj-1' }, mockContext);

    expect(result.propagatedResolutions).toBe(2);
    expect(result.copiedAnswers).toBe(0);
    expect(result.skippedNoMasterAnswer).toBe(1);

    // Both members get an empty answer carrying the master's reason
    expect(mockSaveAnswer).toHaveBeenCalledTimes(2);
    const memberIds = mockSaveAnswer.mock.calls.map((c) => c[0].questionId).sort();
    expect(memberIds).toEqual(['member-1', 'member-2']);
    for (const call of mockSaveAnswer.mock.calls) {
      expect(call[0].resolution).toBe('NO_KB_MATCH');
      expect(call[0].text).toBe('');
      expect(call[0].skipIfAnswered).toBe(true);
      expect(call[0].linkedToMasterQuestionId).toBe('master-1');
    }
  });

  it('falls back to NO_KB_MATCH when a legacy master answer has no recorded resolution', async () => {
    singleCluster({
      clusterId: 'c-1',
      masterQuestionId: 'master-1',
      questionFileId: 'file-1',
      opportunityId: 'opp-1',
      members: [
        { questionId: 'master-1', similarity: 1 },
        { questionId: 'member-1', similarity: 0.95 },
      ],
    });

    // Legacy master: empty text, no resolution field at all
    mockGetAnswerForQuestion.mockResolvedValueOnce({ text: '' });

    const result = await baseHandler({ projectId: 'proj-1' }, mockContext);

    expect(result.propagatedResolutions).toBe(1);
    expect(mockSaveAnswer.mock.calls[0][0].resolution).toBe('NO_KB_MATCH');
  });

  it('propagates GENERATION_FAILED when that is the master resolution', async () => {
    singleCluster({
      clusterId: 'c-1',
      masterQuestionId: 'master-1',
      questionFileId: 'file-1',
      opportunityId: 'opp-1',
      members: [
        { questionId: 'master-1', similarity: 1 },
        { questionId: 'member-1', similarity: 0.95 },
      ],
    });

    mockGetAnswerForQuestion.mockResolvedValueOnce({ text: '', resolution: 'GENERATION_FAILED' });

    const result = await baseHandler({ projectId: 'proj-1' }, mockContext);

    expect(result.propagatedResolutions).toBe(1);
    expect(mockSaveAnswer.mock.calls[0][0].resolution).toBe('GENERATION_FAILED');
  });

  it('copies the master answer (ANSWERED) to members when the master HAS text', async () => {
    singleCluster({
      clusterId: 'c-1',
      masterQuestionId: 'master-1',
      questionFileId: 'file-1',
      opportunityId: 'opp-1',
      members: [
        { questionId: 'master-1', similarity: 1 },
        { questionId: 'member-1', similarity: 0.95 },
      ],
    });

    // Master lookup → has real text. Member lookup → no existing answer.
    mockGetAnswerForQuestion
      .mockResolvedValueOnce({ text: 'A real master answer.', confidence: 0.9, resolution: 'ANSWERED', sources: [] })
      .mockResolvedValueOnce(null);

    const result = await baseHandler({ projectId: 'proj-1' }, mockContext);

    expect(result.copiedAnswers).toBe(1);
    expect(result.propagatedResolutions).toBe(0);
    const saved = mockSaveAnswer.mock.calls[0][0];
    expect(saved.text).toBe('A real master answer.');
    expect(saved.resolution).toBe('ANSWERED');
    // Copy path relies on the member-already-answered lookup, not skipIfAnswered
    expect(saved.skipIfAnswered).toBeUndefined();
  });

  it('does not overwrite a member that already has a real answer (copy path)', async () => {
    singleCluster({
      clusterId: 'c-1',
      masterQuestionId: 'master-1',
      questionFileId: 'file-1',
      opportunityId: 'opp-1',
      members: [
        { questionId: 'master-1', similarity: 1 },
        { questionId: 'member-1', similarity: 0.95 },
      ],
    });

    mockGetAnswerForQuestion
      .mockResolvedValueOnce({ text: 'A real master answer.', confidence: 0.9, sources: [] }) // master
      .mockResolvedValueOnce({ text: 'Member already answered.' }); // member existing

    const result = await baseHandler({ projectId: 'proj-1' }, mockContext);

    expect(result.copiedAnswers).toBe(0);
    expect(mockSaveAnswer).not.toHaveBeenCalled();
  });
});
