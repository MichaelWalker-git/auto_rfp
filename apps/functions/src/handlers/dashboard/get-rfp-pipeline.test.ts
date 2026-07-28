jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockListOpportunitiesByOrg = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  listOpportunitiesByOrg: (...args: unknown[]) => mockListOpportunitiesByOrg(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './get-rfp-pipeline';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (qs: Record<string, string | undefined>): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: qs,
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
    headers: {},
  }) as unknown as APIGatewayProxyEventV2;

describe('get-rfp-pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [] });
  });

  it('returns 400 when orgId is missing', async () => {
    const response = await baseHandler(makeEvent({}));
    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockListOpportunitiesByOrg).not.toHaveBeenCalled();
  });

  it('returns the org-wide opportunity list on the happy path', async () => {
    const items = [
      { id: 'opp-1', title: 'A', status: 'QUALIFYING' },
      { id: 'opp-2', title: 'B', status: 'PURSUING' },
    ];
    mockListOpportunitiesByOrg.mockResolvedValueOnce({ items });

    const response = await baseHandler(makeEvent({ orgId: 'org-123' }));

    expect(mockListOpportunitiesByOrg).toHaveBeenCalledWith({ orgId: 'org-123' });
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(2);
  });

  it('returns 500 when the helper throws', async () => {
    mockListOpportunitiesByOrg.mockRejectedValueOnce(new Error('dynamo down'));
    const response = await baseHandler(makeEvent({ orgId: 'org-123' }));
    expect(response).toMatchObject({ statusCode: 500 });
  });
});
