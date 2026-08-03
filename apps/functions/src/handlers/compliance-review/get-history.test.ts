jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a) }));

const mockIsComplianceReviewEnabled = jest.fn();
jest.mock('@/helpers/compliance-review-access', () => ({
  isComplianceReviewEnabled: (...a: unknown[]) => mockIsComplianceReviewEnabled(...a),
}));

const mockListHistory = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  listComplianceReviewHistory: (...a: unknown[]) => mockListHistory(...a),
}));

import { baseHandler } from './get-history';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

const message = {
  messageId: '11111111-1111-1111-1111-111111111111',
  oppId: 'opp-1',
  role: 'assistant',
  content: 'hello',
  createdAt: '2026-08-03T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
  mockIsComplianceReviewEnabled.mockResolvedValue(true);
  mockListHistory.mockResolvedValue([message]);
});

describe('get-history handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await baseHandler({ queryStringParameters: {} } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockListHistory).not.toHaveBeenCalled();
  });

  it('returns 403 when compliance review is not enabled for the org', async () => {
    mockIsComplianceReviewEnabled.mockResolvedValue(false);
    const res = await baseHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(mockListHistory).not.toHaveBeenCalled();
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValue(null);
    const res = await baseHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(mockListHistory).not.toHaveBeenCalled();
  });

  it('returns the chat history for the opportunity', async () => {
    const res = (await baseHandler(event)) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ messages: [message] });
    expect(mockListHistory).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1');
  });

  it('returns an empty list when there is no history', async () => {
    mockListHistory.mockResolvedValue([]);
    const res = (await baseHandler(event)) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ messages: [] });
  });
});
