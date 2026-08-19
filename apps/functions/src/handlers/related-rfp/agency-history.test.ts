jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

const mockFetchHigherGovOpportunity = jest.fn();
const mockSearchHigherGovOpportunities = jest.fn();
jest.mock('@/helpers/highergov', () => ({
  fetchHigherGovOpportunity: (...args: unknown[]) => mockFetchHigherGovOpportunity(...args),
  searchHigherGovOpportunities: (...args: unknown[]) => mockSearchHigherGovOpportunities(...args),
}));

const mockListRelatedRfps = jest.fn();
jest.mock('@/helpers/related-rfp', () => ({
  listRelatedRfps: (...args: unknown[]) => mockListRelatedRfps(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './agency-history';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (qs: Record<string, string | undefined>): APIGatewayProxyEventV2 =>
  ({ queryStringParameters: qs, headers: {} }) as unknown as APIGatewayProxyEventV2;

const qs = { orgId: 'org', projectId: 'p', oppId: 'o' };

describe('agency-history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListRelatedRfps.mockResolvedValue([]);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await baseHandler(makeEvent({ projectId: 'p', oppId: 'o' }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 404 when opportunity not found', async () => {
    mockGetOpportunity.mockResolvedValueOnce(undefined);
    const res = await baseHandler(makeEvent(qs));
    expect(res).toMatchObject({ statusCode: 404 });
  });

  it('returns empty when opportunity is not HigherGov-sourced', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { title: 't' } });
    const res = await baseHandler(makeEvent(qs));
    expect(res).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((res as { body: string }).body).items).toEqual([]);
  });

  it('flags alreadyRelated and excludes the current opp', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { title: 't', higherGovOppKey: 'K' } });
    mockGetApiKey.mockResolvedValueOnce('api-key');
    mockFetchHigherGovOpportunity.mockResolvedValueOnce({ agency: { agency_key: 9 } });
    mockSearchHigherGovOpportunities.mockResolvedValueOnce({
      results: [
        { opp_key: 'K', title: 'self' },
        { opp_key: 'A', title: 'Linked' },
        { opp_key: 'B', title: 'New' },
      ],
    });
    mockListRelatedRfps.mockResolvedValueOnce([{ relatedOppKey: 'A' }]);

    const res = await baseHandler(makeEvent({ ...qs, q: 'security' }));
    expect(res).toMatchObject({ statusCode: 200 });
    const items = JSON.parse((res as { body: string }).body).items as Array<{
      relatedOppKey: string;
      alreadyRelated: boolean;
    }>;
    expect(items.map((i) => i.relatedOppKey)).toEqual(['A', 'B']);
    expect(items.find((i) => i.relatedOppKey === 'A')?.alreadyRelated).toBe(true);
    expect(items.find((i) => i.relatedOppKey === 'B')?.alreadyRelated).toBe(false);
    expect(mockSearchHigherGovOpportunities).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agencyKey: '9', keywords: 'security' }),
    );
  });
});
