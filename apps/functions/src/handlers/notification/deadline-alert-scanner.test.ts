const mockSendSqs = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSendSqs })),
  SendMessageCommand: jest.fn((params) => ({ type: 'SendMessage', params })),
}));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockDdbSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

const mockQueryByPk = jest.fn();
jest.mock('@/helpers/db', () => ({
  queryByPk: (...args: unknown[]) => mockQueryByPk(...args),
}));

jest.mock('@/constants/common', () => ({
  PK_NAME: 'PK',
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn(() => 'https://sqs.us-east-1.amazonaws.com/123/test-queue'),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

process.env['DB_TABLE_NAME'] = 'test-table';

import { handler } from './deadline-alert-scanner';

const mockOpportunityQuery = (items: any[]) => {
  mockDdbSend.mockResolvedValueOnce({ Items: items });
};

describe('deadline-alert-scanner — decision date notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendSqs.mockResolvedValue({});
    mockQueryByPk.mockResolvedValue([]);
    mockDdbSend.mockResolvedValue({ Items: [] });
  });

  it('sends DECISION_DATE_7_DAYS notification when decision date is ~7 days away', async () => {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Test RFP',
      decisionDateIso: sevenDaysFromNow,
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(mockSendSqs.mock.calls[0][0].params.MessageBody);
    expect(sentPayload.type).toBe('DECISION_DATE_7_DAYS');
    expect(sentPayload.title).toContain('Decision Date Approaching');
    expect(sentPayload.title).toContain('Test RFP');
    expect(sentPayload.recipientUserIds).toEqual(['user-1']);
    expect(sentPayload.orgId).toBe('org-1');
    expect(sentPayload.entityId).toBe('opp-1');
  });

  it('does NOT include link field in notification payload (BUG-1 fix)', async () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Test RFP',
      decisionDateIso: threeDaysFromNow,
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    const sentPayload = JSON.parse(mockSendSqs.mock.calls[0][0].params.MessageBody);
    expect(sentPayload.link).toBeUndefined();
    expect(sentPayload.entityId).toBe('opp-1');
  });

  it('uses FilterExpression to only query opportunities with decision dates (BUG-2 fix)', async () => {
    mockOpportunityQuery([]);

    await (handler as any)({});

    // Verify the QueryCommand was called with a FilterExpression
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb');
    expect(QueryCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        FilterExpression: expect.stringContaining('attribute_exists'),
      }),
    );
  });

  it('sends DECISION_DATE_3_DAYS notification when decision date is ~3 days away', async () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Urgent RFP',
      decisionDateIso: threeDaysFromNow,
      assigneeId: 'user-2',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(mockSendSqs.mock.calls[0][0].params.MessageBody);
    expect(sentPayload.type).toBe('DECISION_DATE_3_DAYS');
    expect(sentPayload.recipientUserIds).toEqual(['user-2']);
  });

  it('sends DECISION_DATE_1_DAY notification when decision date is ~1 day away', async () => {
    const oneDayFromNow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Tomorrow RFP',
      decisionDateIso: oneDayFromNow,
      assigneeId: 'user-3',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(mockSendSqs.mock.calls[0][0].params.MessageBody);
    expect(sentPayload.type).toBe('DECISION_DATE_1_DAY');
  });

  it('uses contractStartDateIso as fallback and labels it correctly', async () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Contract RFP',
      contractStartDateIso: threeDaysFromNow,
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(mockSendSqs.mock.calls[0][0].params.MessageBody);
    expect(sentPayload.title).toContain('Contract Start Date Approaching');
    expect(sentPayload.message).toContain('contract start date');
  });

  it('does not send notification for past decision dates', async () => {
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Past RFP',
      decisionDateIso: pastDate,
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).not.toHaveBeenCalled();
  });

  it('does not send notification for opportunities without orgId', async () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'No Org RFP',
      decisionDateIso: threeDaysFromNow,
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).not.toHaveBeenCalled();
  });

  it('sends notification with empty recipientUserIds when no assignee', async () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Unassigned RFP',
      decisionDateIso: threeDaysFromNow,
    }]);

    await (handler as any)({});

    expect(mockSendSqs).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(mockSendSqs.mock.calls[0][0].params.MessageBody);
    expect(sentPayload.recipientUserIds).toEqual([]);
  });

  it('does not send notification when decision date is far in the future', async () => {
    const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'Future RFP',
      decisionDateIso: farFuture,
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).not.toHaveBeenCalled();
  });

  it('skips opportunities with no decision date or contract start', async () => {
    mockOpportunityQuery([{
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      id: 'opp-1',
      title: 'No Dates',
      assigneeId: 'user-1',
    }]);

    await (handler as any)({});

    expect(mockSendSqs).not.toHaveBeenCalled();
  });
});
