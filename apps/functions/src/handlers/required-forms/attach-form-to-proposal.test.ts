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

const mockGetForm = jest.fn();
const mockUpdateForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...args: unknown[]) => mockGetForm(...args),
  updateRequiredForm: (...args: unknown[]) => mockUpdateForm(...args),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string>; body?: string | null }) => {
    if (event.queryStringParameters?.orgId) return event.queryStringParameters.orgId;
    if (event.body) {
      try {
        const b = JSON.parse(event.body);
        return b.orgId;
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './attach-form-to-proposal';

const postEvent = (body: Record<string, string>): APIGatewayProxyEventV2 =>
  ({
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify(body),
    queryStringParameters: { orgId: body.orgId },
  } as unknown as APIGatewayProxyEventV2);

const deleteEvent = (q: Record<string, string>): APIGatewayProxyEventV2 =>
  ({
    requestContext: { http: { method: 'DELETE' } },
    queryStringParameters: q,
  } as unknown as APIGatewayProxyEventV2);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('attach-form-to-proposal', () => {
  it('attaches a form on POST and sets attachedAt', async () => {
    mockGetForm.mockResolvedValueOnce({ formId: 'f', attachedToProposal: false });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f', attachedToProposal: true });

    const res = await baseHandler(postEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }));

    expect(res.statusCode).toBe(200);
    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.attachedToProposal).toBe(true);
    expect(patch.attachedAt).toEqual(expect.any(String));
  });

  it('detaches a form on DELETE and clears attachedAt', async () => {
    mockGetForm.mockResolvedValueOnce({ formId: 'f', attachedToProposal: true });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f', attachedToProposal: false });

    const res = await baseHandler(deleteEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }));

    expect(res.statusCode).toBe(200);
    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.attachedToProposal).toBe(false);
    expect(patch.attachedAt).toBeNull();
  });

  it('returns 404 when form is missing', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(postEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 on invalid payload', async () => {
    const res = await baseHandler(postEvent({ orgId: 'org' } as Record<string, string>));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(deleteEvent({ projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(400);
  });
});
