jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  Sentry: { addBreadcrumb: jest.fn() },
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: (_key: string, fallback?: string) => fallback ?? 'test-value',
}));

// Capture DynamoDB commands by the partition key they target.
const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: jest.fn() })),
  StartExecutionCommand: jest.fn((params) => ({ type: 'StartExecution', params })),
}));

const mockListAllOrgIds = jest.fn();
jest.mock('@/helpers/org', () => ({
  listAllOrgIds: (...args: unknown[]) => mockListAllOrgIds(...args),
}));

const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

// Helpers whose modules also pull in AWS clients; stub to inert values.
jest.mock('@/helpers/search-opportunity', () => ({
  searchSamOpportunities: jest.fn(),
  searchDibbsOpportunities: jest.fn(),
  searchHigherGovOpportunities: jest.fn(),
  fetchDibbsSolicitation: jest.fn(),
  extractDibbsAttachments: jest.fn(),
  fetchHigherGovDocuments: jest.fn(),
  fetchOpportunityViaSearch: jest.fn(),
  extractAttachmentsFromOpportunity: jest.fn(),
  buildAttachmentFilename: jest.fn(),
  buildAttachmentS3Key: jest.fn(),
  httpsGetBuffer: jest.fn(),
  guessContentType: jest.fn(),
  safeIsoOrNull: jest.fn(),
  toBoolActive: jest.fn(),
}));
jest.mock('@/helpers/s3', () => ({ uploadToS3: jest.fn() }));
jest.mock('@/helpers/questionFile', () => ({
  buildQuestionFileSK: jest.fn(() => 'qf-sk'),
  updateQuestionFile: jest.fn(),
}));
jest.mock('@/helpers/opportunity', () => ({
  createOpportunity: jest.fn(),
  findOpportunityBySourceId: jest.fn(),
}));

import { SAVED_SEARCH_PK } from '@/constants/samgov';
import { PROJECT_PK } from '@/constants/organization';
import type { EventBridgeEvent } from 'aws-lambda';
import { baseHandler } from './run-saved-search';

type RunnerEvent = EventBridgeEvent<'sam.runSavedSearches', { dryRun?: boolean; orgId?: string }>;

const makeEvent = (detail: { dryRun?: boolean; orgId?: string }): RunnerEvent =>
  ({ detail } as unknown as RunnerEvent);

// Returns the :pk value of a captured Query command, or undefined.
const queryPk = (call: unknown): string | undefined => {
  const cmd = call as { params?: { ExpressionAttributeValues?: Record<string, unknown> } };
  return cmd?.params?.ExpressionAttributeValues?.[':pk'] as string | undefined;
};

describe('run-saved-search handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetApiKey.mockResolvedValue(null);
  });

  it('does not query for a default project when no saved search is due', async () => {
    const orgIds = ['org-a', 'org-b', 'org-c'];
    mockListAllOrgIds.mockResolvedValue(orgIds);

    // Every org has a disabled saved search — none should run.
    mockSend.mockImplementation((cmd: { params?: { ExpressionAttributeValues?: Record<string, unknown> } }) => {
      const pk = cmd?.params?.ExpressionAttributeValues?.[':pk'];
      if (pk === SAVED_SEARCH_PK) {
        return Promise.resolve({
          Items: [
            {
              savedSearchId: 's-1',
              orgId: 'org',
              name: 'disabled',
              criteria: {},
              frequency: 'DAILY',
              autoImport: false,
              notifyEmails: [],
              isEnabled: false,
              lastRunAt: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve({ Items: [] });
    });

    const result = await baseHandler(makeEvent({ dryRun: true }));

    expect(result.orgCount).toBe(3);
    expect(result.orgsWithWork).toBe(0);

    // One SAVED_SEARCH query per org, and ZERO PROJECT lookups (the regression).
    const savedSearchQueries = mockSend.mock.calls.filter(([c]) => queryPk(c) === SAVED_SEARCH_PK);
    const projectQueries = mockSend.mock.calls.filter(([c]) => queryPk(c) === PROJECT_PK);
    expect(savedSearchQueries).toHaveLength(3);
    expect(projectQueries).toHaveLength(0);
  });

  it('skips orgs with no saved searches without extra queries', async () => {
    mockListAllOrgIds.mockResolvedValue(['org-a', 'org-b']);
    mockSend.mockResolvedValue({ Items: [] });

    const result = await baseHandler(makeEvent({ dryRun: true }));

    expect(result.orgCount).toBe(2);
    expect(result.orgsWithWork).toBe(0);
    // Only the per-org SAVED_SEARCH listing; no PROJECT lookups.
    expect(mockSend.mock.calls.filter(([c]) => queryPk(c) === PROJECT_PK)).toHaveLength(0);
  });
});
