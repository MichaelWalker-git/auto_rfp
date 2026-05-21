jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  TransientServiceError: class extends Error {},
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockApprove = jest.fn();
jest.mock('@/helpers/question', () => ({
  approveQuestion: (...args: unknown[]) => mockApprove(...args),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './approve-question';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const validBody = {
  orgId: 'org', projectId: 'p', opportunityId: 'o',
  questionFileId: 'qf', questionId: 'q1',
};

const eventFor = (overrides: { body?: unknown; userId?: string; claims?: Record<string, string> } = {}) =>
  ({
    body: overrides.body === undefined ? JSON.stringify(validBody) : (typeof overrides.body === 'string' ? overrides.body : JSON.stringify(overrides.body)),
    auth: overrides.userId === undefined ? { userId: 'user-1', claims: overrides.claims ?? {} } : { userId: overrides.userId, claims: overrides.claims ?? {} },
  } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('approve-question', () => {
  it('returns 400 when body is missing', async () => {
    const event = { auth: { userId: 'u' } } as unknown as AuthedEvent;
    const res = await baseHandler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid payload', async () => {
    const res = await baseHandler(eventFor({ body: { orgId: 'o' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when userId is missing', async () => {
    const res = await baseHandler(eventFor({ userId: '' }));
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when question is not found', async () => {
    mockApprove.mockResolvedValueOnce(null);
    const res = await baseHandler(eventFor());
    expect(res.statusCode).toBe(404);
  });

  it('approves and uses given_name + family_name as displayName', async () => {
    mockApprove.mockResolvedValueOnce({ questionId: 'q1', approvedBy: 'user-1' });
    const res = await baseHandler(
      eventFor({ claims: { given_name: 'Ada', family_name: 'Lovelace' } }),
    );
    expect(res.statusCode).toBe(200);
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'q1',
      userId: 'user-1',
      userName: 'Ada Lovelace',
    }));
  });

  it('falls back to email when name claims are absent', async () => {
    mockApprove.mockResolvedValueOnce({ questionId: 'q1', approvedBy: 'user-1' });
    await baseHandler(eventFor({ claims: { email: 'ada@example.com' } }));
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ userName: 'ada@example.com' }));
  });
});
