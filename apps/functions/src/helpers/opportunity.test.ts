const mockQueryAllBySkPrefix = jest.fn();
const mockCreateItem = jest.fn();
jest.mock('./db', () => ({
  queryAllBySkPrefix: (...args: unknown[]) => mockQueryAllBySkPrefix(...args),
  createItem: (...args: unknown[]) => mockCreateItem(...args),
  docClient: { send: jest.fn() },
}));

const mockEnrichWithUserNames = jest.fn();
jest.mock('./resolve-users', () => ({
  enrichWithUserNames: (...args: unknown[]) => mockEnrichWithUserNames(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { listOpportunitiesByOrg, buildOpportunitySk, parseOpportunitySk } from './opportunity';
import { OPPORTUNITY_PK } from '../constants/opportunity';

describe('opportunity SK builders', () => {
  it('builds and parses an SK round-trip', () => {
    const sk = buildOpportunitySk('org-1', 'proj-1', 'opp-1');
    expect(sk).toBe('org-1#proj-1#opp-1');
    expect(parseOpportunitySk(sk)).toEqual({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' });
  });
});

describe('listOpportunitiesByOrg', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryAllBySkPrefix.mockResolvedValue([]);
    mockEnrichWithUserNames.mockImplementation(async (_org: string, items: unknown[]) => items);
  });

  it('queries by the org SK prefix and enriches results', async () => {
    const raw = [{ oppId: 'opp-1', status: 'QUALIFYING' }];
    mockQueryAllBySkPrefix.mockResolvedValueOnce(raw);
    const enriched = [{ oppId: 'opp-1', status: 'QUALIFYING', createdByName: 'Alice' }];
    mockEnrichWithUserNames.mockResolvedValueOnce(enriched);

    const result = await listOpportunitiesByOrg({ orgId: 'org-1' });

    expect(mockQueryAllBySkPrefix).toHaveBeenCalledWith(OPPORTUNITY_PK, 'org-1#');
    expect(mockEnrichWithUserNames).toHaveBeenCalledWith('org-1', raw);
    expect(result).toEqual({ items: enriched });
  });

  it('scopes the query to the project SK prefix when projectId is passed', async () => {
    await listOpportunitiesByOrg({ orgId: 'org-1', projectId: 'gov-contracting' });

    expect(mockQueryAllBySkPrefix).toHaveBeenCalledWith(OPPORTUNITY_PK, 'org-1#gov-contracting#');
  });

  it('returns an empty list when the org has no opportunities', async () => {
    const result = await listOpportunitiesByOrg({ orgId: 'empty-org' });
    expect(result).toEqual({ items: [] });
  });
});
