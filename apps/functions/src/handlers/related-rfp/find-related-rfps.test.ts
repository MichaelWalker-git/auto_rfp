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

const mockRankRelatedRfps = jest.fn();
const mockDeleteAutoRelatedRfps = jest.fn();
const mockCreateRelatedRfp = jest.fn();
const mockListSuppressedOppKeys = jest.fn();
const mockResolveLinkedOpportunityId = jest.fn();
jest.mock('@/helpers/related-rfp', () => ({
  rankRelatedRfps: (...args: unknown[]) => mockRankRelatedRfps(...args),
  deleteAutoRelatedRfps: (...args: unknown[]) => mockDeleteAutoRelatedRfps(...args),
  createRelatedRfp: (...args: unknown[]) => mockCreateRelatedRfp(...args),
  listSuppressedOppKeys: (...args: unknown[]) => mockListSuppressedOppKeys(...args),
  resolveLinkedOpportunityId: (...args: unknown[]) => mockResolveLinkedOpportunityId(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { findRelatedRfpsForOpportunity } from './find-related-rfps';

const input = { orgId: 'org', projectId: 'p', oppId: 'o' };

describe('find-related-rfps worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListSuppressedOppKeys.mockResolvedValue(new Set());
    mockDeleteAutoRelatedRfps.mockResolvedValue(undefined);
    mockCreateRelatedRfp.mockResolvedValue({});
    mockResolveLinkedOpportunityId.mockResolvedValue(null);
  });

  it('skips when identifiers missing', async () => {
    const res = await findRelatedRfpsForOpportunity({ orgId: '', projectId: '', oppId: '' });
    expect(res).toEqual({ created: 0, skippedReason: 'missing-identifiers' });
  });

  it('skips when opportunity not found', async () => {
    mockGetOpportunity.mockResolvedValueOnce(undefined);
    const res = await findRelatedRfpsForOpportunity(input);
    expect(res).toEqual({ created: 0, skippedReason: 'opportunity-not-found' });
  });

  it('skips when opportunity is not HigherGov-sourced', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { title: 't' } });
    const res = await findRelatedRfpsForOpportunity(input);
    expect(res).toEqual({ created: 0, skippedReason: 'not-highergov-sourced' });
  });

  it('skips when no API key', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { title: 't', higherGovOppKey: 'K' } });
    mockGetApiKey.mockResolvedValueOnce(undefined);
    const res = await findRelatedRfpsForOpportunity(input);
    expect(res).toEqual({ created: 0, skippedReason: 'no-highergov-key' });
  });

  it('skips when agency_key cannot be resolved', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { title: 't', higherGovOppKey: 'K' } });
    mockGetApiKey.mockResolvedValueOnce('api-key');
    mockFetchHigherGovOpportunity.mockResolvedValueOnce({ agency: {} });
    const res = await findRelatedRfpsForOpportunity(input);
    expect(res).toEqual({ created: 0, skippedReason: 'no-agency-key' });
  });

  it('replaces AUTO links then creates ranked matches', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: { title: 't', description: 'd', higherGovOppKey: 'K', naicsCode: '541511' },
    });
    mockGetApiKey.mockResolvedValueOnce('api-key');
    mockFetchHigherGovOpportunity.mockResolvedValueOnce({ agency: { agency_key: 123 } });
    mockSearchHigherGovOpportunities.mockResolvedValueOnce({ results: [{ opp_key: 'A' }, { opp_key: 'B' }] });
    mockRankRelatedRfps.mockReturnValueOnce([
      { cand: { opp_key: 'A', title: 'Match A' }, score: 0.8 },
      { cand: { opp_key: 'B', title: 'Match B' }, score: 0.5 },
    ]);

    const res = await findRelatedRfpsForOpportunity(input);

    expect(mockSearchHigherGovOpportunities).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agencyKey: '123' }),
    );
    expect(mockDeleteAutoRelatedRfps).toHaveBeenCalledWith('org', 'p', 'o');
    expect(mockCreateRelatedRfp).toHaveBeenCalledTimes(2);
    expect(mockCreateRelatedRfp).toHaveBeenCalledWith(
      expect.objectContaining({ relatedOppKey: 'A', origin: 'AUTO', matchScore: 0.8 }),
    );
    expect(res).toEqual({ created: 2 });
  });
});
