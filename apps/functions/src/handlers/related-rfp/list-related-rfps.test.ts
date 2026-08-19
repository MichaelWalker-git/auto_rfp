jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));

const mockListRelatedRfps = jest.fn();
jest.mock('@/helpers/related-rfp', () => ({
  listRelatedRfps: (...args: unknown[]) => mockListRelatedRfps(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './list-related-rfps';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (qs: Record<string, string | undefined>): APIGatewayProxyEventV2 =>
  ({ queryStringParameters: qs, headers: {} }) as unknown as APIGatewayProxyEventV2;

const row = (over: Record<string, unknown>) => ({
  id: 'id',
  relatedOppKey: 'k',
  title: 't',
  organizationName: null,
  postedDateIso: null,
  dueDateIso: null,
  sourceUrl: null,
  matchScore: null,
  origin: 'MANUAL',
  linkedOpportunityId: null,
  createdAt: undefined,
  createdByName: undefined,
  ...over,
});

describe('list-related-rfps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListRelatedRfps.mockResolvedValue([]);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await baseHandler(makeEvent({ projectId: 'p', oppId: 'o' }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 when projectId missing', async () => {
    const res = await baseHandler(makeEvent({ orgId: 'org', oppId: 'o' }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 when oppId missing', async () => {
    const res = await baseHandler(makeEvent({ orgId: 'org', projectId: 'p' }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('sorts AUTO before MANUAL, then by matchScore desc', async () => {
    mockListRelatedRfps.mockResolvedValueOnce([
      row({ id: 'm1', origin: 'MANUAL', relatedOppKey: 'm1' }),
      row({ id: 'a-low', origin: 'AUTO', matchScore: 0.2, relatedOppKey: 'a-low' }),
      row({ id: 'a-high', origin: 'AUTO', matchScore: 0.9, relatedOppKey: 'a-high' }),
    ]);

    const res = await baseHandler(makeEvent({ orgId: 'org', projectId: 'p', oppId: 'o' }));
    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['a-high', 'a-low', 'm1']);
  });

  it('passes (orgId, projectId, oppId) to the helper', async () => {
    await baseHandler(makeEvent({ orgId: 'org', projectId: 'p', oppId: 'o' }));
    expect(mockListRelatedRfps).toHaveBeenCalledWith('org', 'p', 'o');
  });
});
