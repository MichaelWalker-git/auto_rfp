process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((p) => ({ type: 'Query', params: p })),
}));

const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
const mockQueryByPk = jest.fn();
const mockQueryBySkPrefix = jest.fn();
jest.mock('@/helpers/db', () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  putItem: (...a: unknown[]) => mockPutItem(...a),
  queryByPk: (...a: unknown[]) => mockQueryByPk(...a),
  queryBySkPrefix: (...a: unknown[]) => mockQueryBySkPrefix(...a),
}));

import { findOrgByScrapeMailbox } from './foia-settings';

const settings = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-horus',
  scrapeMailbox: 'foia@inbox.horustech.dev',
  mailScrapeEnabled: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryByPk.mockResolvedValue([settings()]);
});

describe('findOrgByScrapeMailbox', () => {
  it('resolves the org that claims the address', async () => {
    await expect(findOrgByScrapeMailbox(['foia@inbox.horustech.dev'])).resolves.toBe('org-horus');
  });

  it('reads the whole partition rather than using an empty sk prefix', async () => {
    /**
     * Regression from the first real inbound message. This used
     * `queryBySkPrefix(PK, '')`, and DynamoDB rejects an empty string inside a
     * `begins_with` on a key attribute — so every message died on a
     * ValidationException that named `sort_key`, which reads like a write bug and
     * sent me looking in the wrong place entirely.
     */
    await findOrgByScrapeMailbox(['foia@inbox.horustech.dev']);

    expect(mockQueryByPk).toHaveBeenCalledWith('ORG_FOIA_SETTINGS');
    expect(mockQueryBySkPrefix).not.toHaveBeenCalled();
  });

  it('matches case-insensitively and ignores a display name', async () => {
    await expect(
      findOrgByScrapeMailbox(['FOIA Inbox <FOIA@Inbox.HorusTech.dev>']),
    ).resolves.toBe('org-horus');
  });

  it('refuses when the org has not enabled the scrape', async () => {
    // Storing an address is not consent to having opportunities moved by email.
    mockQueryByPk.mockResolvedValue([settings({ mailScrapeEnabled: false })]);

    await expect(findOrgByScrapeMailbox(['foia@inbox.horustech.dev'])).resolves.toBeNull();
  });

  it('refuses when no org claims the address', async () => {
    await expect(findOrgByScrapeMailbox(['someone@else.com'])).resolves.toBeNull();
  });

  it('refuses when two orgs claim the same mailbox', async () => {
    // Attributing to either would leak one tenant's procurement correspondence
    // into the other's records.
    mockQueryByPk.mockResolvedValue([settings(), settings({ orgId: 'org-other' })]);

    await expect(findOrgByScrapeMailbox(['foia@inbox.horustech.dev'])).resolves.toBeNull();
  });

  it('refuses on an empty recipient list without querying', async () => {
    await expect(findOrgByScrapeMailbox([])).resolves.toBeNull();
    expect(mockQueryByPk).not.toHaveBeenCalled();
  });

  it('ignores settings with no mailbox configured', async () => {
    mockQueryByPk.mockResolvedValue([settings({ scrapeMailbox: null })]);

    await expect(findOrgByScrapeMailbox(['foia@inbox.horustech.dev'])).resolves.toBeNull();
  });
});
