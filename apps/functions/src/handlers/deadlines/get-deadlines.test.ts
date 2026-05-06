jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/helpers/deadline-calculations', () => ({
  calculateDaysUntil: jest.fn((dateIso: string | undefined) => {
    if (!dateIso) return undefined;
    const now = Date.now();
    const deadlineMs = new Date(dateIso).getTime();
    return Math.ceil((deadlineMs - now) / (24 * 60 * 60 * 1000));
  }),
  getWarningLevel: jest.fn((daysUntil: number | undefined) => {
    if (daysUntil === undefined) return 'upcoming';
    if (daysUntil < 0) return 'past';
    if (daysUntil <= 3) return 'urgent';
    if (daysUntil <= 7) return 'warning';
    return 'upcoming';
  }),
  calculateRecommendedSubmitBy: jest.fn((dateIso: string) => {
    return new Date(new Date(dateIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
  }),
}));

process.env['DB_TABLE_NAME'] = 'test-table';

import { baseHandler } from './get-deadlines';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (queryParams: Record<string, string> = {}): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: queryParams,
    headers: {},
    requestContext: { http: { method: 'GET' } },
  }) as unknown as APIGatewayProxyEventV2;

describe('get-deadlines handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('decision date injection', () => {
    it('returns synthetic DECISION_DATE deadline when opportunity has decisionDateIso', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

      // First call: DEADLINE query (empty)
      // Second call: OPPORTUNITY query (has decision date)
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-1',
            id: 'opp-1',
            title: 'Test Opportunity',
            decisionDateIso: futureDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      expect(body.ok).toBe(true);
      expect(body.count).toBe(1);
      expect(body.deadlines).toHaveLength(1);
      expect(body.deadlines[0].opportunityId).toBe('opp-1');
      expect(body.deadlines[0].opportunityTitle).toBe('Test Opportunity');
      expect(body.deadlines[0].deadlines[0].type).toBe('DECISION_DATE');
      expect(body.deadlines[0].deadlines[0].label).toBe('Decision Date');
      expect(body.deadlines[0].deadlines[0].dateTimeIso).toBe(futureDate);
    });

    it('returns CONTRACT_START type when only contractStartDateIso is set', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-2',
            id: 'opp-2',
            title: 'Contract Opportunity',
            contractStartDateIso: futureDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      expect(body.deadlines[0].deadlines[0].type).toBe('CONTRACT_START');
      expect(body.deadlines[0].deadlines[0].label).toBe('Contract Start (fallback)');
    });

    it('prefers decisionDateIso over contractStartDateIso when both are set', async () => {
      const decisionDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const contractDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-3',
            id: 'opp-3',
            title: 'Both Dates',
            decisionDateIso: decisionDate,
            contractStartDateIso: contractDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      expect(body.deadlines[0].deadlines[0].type).toBe('DECISION_DATE');
      expect(body.deadlines[0].deadlines[0].dateTimeIso).toBe(decisionDate);
    });

    it('skips opportunities without decision or contract start dates', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({
          Items: [
            { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-no-date', id: 'opp-no-date', title: 'No Dates' },
          ],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      expect(body.count).toBe(0);
      expect(body.deadlines).toHaveLength(0);
    });

    it('skips opportunity decision dates query when orgId is not provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await baseHandler(makeEvent({}));
      const body = JSON.parse((result as any).body);

      // Only one DynamoDB call (deadlines), not two
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(body.ok).toBe(true);
    });

    it('merges regular deadlines with decision date deadlines', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

      mockSend
        .mockResolvedValueOnce({
          Items: [{
            projectId: 'proj-1',
            orgId: 'org-1',
            opportunityId: 'opp-1',
            opportunityTitle: 'Existing Opp',
            deadlines: [{ type: 'PROPOSAL_DUE', label: 'Proposal Due', dateTimeIso: futureDate }],
          }],
        })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-2',
            id: 'opp-2',
            title: 'Decision Opp',
            decisionDateIso: futureDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      expect(body.count).toBe(2);
      expect(body.deadlines).toHaveLength(2);
    });

    it('filters decision date deadlines when urgentOnly is true', async () => {
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-1',
            id: 'opp-1',
            title: 'Far Future',
            decisionDateIso: farFuture,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1', urgentOnly: 'true' }));
      const body = JSON.parse((result as any).body);

      expect(body.count).toBe(0);
      expect(body.deadlines).toHaveLength(0);
    });
  });

  describe('performance filtering — BUG-4 fix', () => {
    it('uses FilterExpression on opportunity query to only return items with decision dates', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({ Items: [] });

      await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));

      // Second call is the opportunity query
      const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb');
      const oppQueryCall = QueryCommand.mock.calls.find(
        (call: any[]) => call[0]?.ExpressionAttributeValues?.[':pk'] === 'OPPORTUNITY',
      );
      expect(oppQueryCall).toBeDefined();
      expect(oppQueryCall[0].FilterExpression).toBe('attribute_exists(#dd) OR attribute_exists(#cs)');
    });
  });

  describe('deduplication — BUG-3 fix', () => {
    it('skips synthetic DECISION_DATE when AI already extracted one for the same opportunity', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

      // AI-extracted deadline with DECISION_DATE for opp-1
      mockSend
        .mockResolvedValueOnce({
          Items: [{
            projectId: 'proj-1',
            orgId: 'org-1',
            opportunityId: 'opp-1',
            opportunityTitle: 'Opp With AI Date',
            deadlines: [{ type: 'DECISION_DATE', label: 'AI Decision Date', dateTimeIso: futureDate }],
          }],
        })
        // Same opportunity has decisionDateIso on the opportunity item
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-1',
            id: 'opp-1',
            title: 'Opp With AI Date',
            decisionDateIso: futureDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      // Only the AI-extracted one should appear, not the synthetic duplicate
      expect(body.count).toBe(1);
      expect(body.deadlines).toHaveLength(1);
      expect(body.deadlines[0].deadlines[0].label).toBe('AI Decision Date');
    });

    it('skips synthetic DECISION_DATE when AI extracted AWARD_ESTIMATE for the same opportunity', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

      mockSend
        .mockResolvedValueOnce({
          Items: [{
            projectId: 'proj-1',
            orgId: 'org-1',
            opportunityId: 'opp-1',
            opportunityTitle: 'Opp Award',
            deadlines: [{ type: 'AWARD_ESTIMATE', label: 'Award Estimate', dateTimeIso: futureDate }],
          }],
        })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-1',
            id: 'opp-1',
            title: 'Opp Award',
            decisionDateIso: futureDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      expect(body.count).toBe(1);
      expect(body.deadlines[0].deadlines[0].type).toBe('AWARD_ESTIMATE');
    });

    it('includes synthetic DECISION_DATE when AI deadline is for a different opportunity', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

      mockSend
        .mockResolvedValueOnce({
          Items: [{
            projectId: 'proj-1',
            orgId: 'org-1',
            opportunityId: 'opp-other',
            opportunityTitle: 'Other Opp',
            deadlines: [{ type: 'DECISION_DATE', label: 'Other Decision', dateTimeIso: futureDate }],
          }],
        })
        .mockResolvedValueOnce({
          Items: [{
            orgId: 'org-1',
            projectId: 'proj-1',
            oppId: 'opp-1',
            id: 'opp-1',
            title: 'My Opp',
            decisionDateIso: futureDate,
          }],
        });

      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      const body = JSON.parse((result as any).body);

      // Both should appear — different opportunities
      expect(body.count).toBe(2);
    });
  });
});
