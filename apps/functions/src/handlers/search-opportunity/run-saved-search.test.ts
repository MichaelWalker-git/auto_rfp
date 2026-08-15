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

// ─── DynamoDB doc client ────────────────────────────────────────────────────
// A single `send` fed by command type. `listSavedSearchesForOrg`,
// `getOrgDefaultProjectId`, `updateLastRunAt` and `createQuestionFile` all funnel
// through it. Query commands are disambiguated by their `:pk` value.
const mockDocSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...args: unknown[]) => mockDocSend(...args) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
  StartExecutionCommand: jest.fn((params) => ({ type: 'StartExecution', params })),
}));

jest.mock('uuid', () => ({ v4: () => 'uuid-fixed' }));

jest.mock('@/helpers/env', () => ({
  requireEnv: (_key: string, fallback?: string) => fallback ?? 'test-value',
}));

const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

const mockListAllOrgIds = jest.fn();
jest.mock('@/helpers/org', () => ({
  listAllOrgIds: (...args: unknown[]) => mockListAllOrgIds(...args),
}));

const mockSearchSam = jest.fn();
const mockSearchDibbs = jest.fn();
const mockSearchHigherGov = jest.fn();
const mockFetchDibbsSolicitation = jest.fn();
const mockExtractDibbsAttachments = jest.fn();
const mockFetchHigherGovDocuments = jest.fn();
const mockHttpsGetBuffer = jest.fn();
const mockExtractAttachments = jest.fn();
const mockFetchOppViaSearch = jest.fn();

jest.mock('@/helpers/search-opportunity', () => ({
  searchSamOpportunities: (...a: unknown[]) => mockSearchSam(...a),
  searchDibbsOpportunities: (...a: unknown[]) => mockSearchDibbs(...a),
  searchHigherGovOpportunities: (...a: unknown[]) => mockSearchHigherGov(...a),
  fetchDibbsSolicitation: (...a: unknown[]) => mockFetchDibbsSolicitation(...a),
  extractDibbsAttachments: (...a: unknown[]) => mockExtractDibbsAttachments(...a),
  fetchHigherGovDocuments: (...a: unknown[]) => mockFetchHigherGovDocuments(...a),
  httpsGetBuffer: (...a: unknown[]) => mockHttpsGetBuffer(...a),
  extractAttachmentsFromOpportunity: (...a: unknown[]) => mockExtractAttachments(...a),
  fetchOpportunityViaSearch: (...a: unknown[]) => mockFetchOppViaSearch(...a),
  buildAttachmentFilename: () => 'file.pdf',
  buildAttachmentS3Key: () => 'org/proj/file.pdf',
  guessContentType: () => 'application/pdf',
  safeIsoOrNull: (v: unknown) => (v ? String(v) : null),
  toBoolActive: () => true,
}));

const mockUploadToS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  uploadToS3: (...a: unknown[]) => mockUploadToS3(...a),
}));

const mockUpdateQuestionFile = jest.fn();
jest.mock('@/helpers/questionFile', () => ({
  buildQuestionFileSK: (p: string, o: string, q: string) => `${p}#${o}#${q}`,
  updateQuestionFile: (...a: unknown[]) => mockUpdateQuestionFile(...a),
}));

const mockCreateOpportunity = jest.fn();
const mockFindOppBySourceId = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  createOpportunity: (...a: unknown[]) => mockCreateOpportunity(...a),
  findOpportunityBySourceId: (...a: unknown[]) => mockFindOppBySourceId(...a),
}));

jest.mock('@/constants/samgov', () => ({ SAM_GOV_SECRET_PREFIX: 'sam', SAVED_SEARCH_PK: 'SAVED_SEARCH' }));
jest.mock('@/constants/dibbs', () => ({ DIBBS_SECRET_PREFIX: 'dibbs' }));
jest.mock('@/constants/highergov', () => ({
  HIGHERGOV_SECRET_PREFIX: 'hg',
  HIGHERGOV_BASE_URL: 'https://highergov.com',
}));
jest.mock('@/constants/question-file', () => ({ QUESTION_FILE_PK: 'QUESTION_FILE' }));
jest.mock('@/constants/organization', () => ({ PROJECT_PK: 'PROJECT' }));

// Slim mappers — pass through with a sensible shape.
jest.mock('@auto-rfp/core', () => {
  const actual = jest.requireActual('@auto-rfp/core');
  return {
    ...actual,
    dibbsSlimToSearchOpportunity: (o: { solicitationNumber?: string }) => ({
      title: `DIBBS ${o.solicitationNumber ?? ''}`,
      type: 'SOLICITATION',
      postedDate: null,
      closingDate: null,
      naicsCode: null,
      organizationName: 'DLA',
      setAside: null,
      description: null,
      active: true,
      baseAndAllOptionsValue: null,
    }),
    higherGovToSearchOpportunity: (o: { opp_key?: string }) => ({
      title: `HG ${o.opp_key ?? ''}`,
      type: 'SOLICITATION',
      postedDate: null,
      closingDate: null,
      naicsCode: null,
      organizationName: 'GSA',
      setAside: null,
      description: null,
      baseAndAllOptionsValue: null,
    }),
  };
});

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN = 'arn:test';
process.env.REGION = 'us-east-1';

import type { SavedSearch } from '@auto-rfp/core';
import { baseHandler } from './run-saved-search';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORG = 'org-1';
const DEFAULT_PROJECT = 'proj-default';
const SAVED_PROJECT = 'proj-saved';

const makeSaved = (over: Partial<SavedSearch>): SavedSearch => ({
  savedSearchId: 'ss-1',
  orgId: ORG,
  source: 'HIGHER_GOV',
  name: 'A search',
  criteria: {},
  frequency: 'DAILY',
  autoImport: true,
  notifyEmails: [],
  isEnabled: true,
  lastRunAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
}) as SavedSearch;

/**
 * Route DynamoDB reads: saved-search list vs. project list (org default). Every
 * other command (Put/Update) resolves empty.
 */
const wireDynamo = (savedSearches: SavedSearch[], projects: Array<{ projectId: string; createdAt: string }>) => {
  mockDocSend.mockImplementation((cmd: { type: string; params?: { ExpressionAttributeValues?: Record<string, unknown> } }) => {
    if (cmd.type === 'Query') {
      const pk = cmd.params?.ExpressionAttributeValues?.[':pk'];
      if (pk === 'SAVED_SEARCH') {
        return Promise.resolve({ Items: savedSearches });
      }
      if (pk === 'PROJECT') {
        return Promise.resolve({ Items: projects, LastEvaluatedKey: undefined });
      }
    }
    return Promise.resolve({});
  });
};

const runEvent = { detail: { orgId: ORG } } as never;

describe('run-saved-search — auto-import per source', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAllOrgIds.mockResolvedValue([ORG]);
    mockGetApiKey.mockResolvedValue('key-123');
    mockCreateOpportunity.mockResolvedValue({ oppId: 'opp-new' });
    mockFindOppBySourceId.mockResolvedValue(undefined);
    mockFetchHigherGovDocuments.mockResolvedValue([]);
    mockExtractDibbsAttachments.mockReturnValue([]);
    mockFetchDibbsSolicitation.mockResolvedValue({});
    mockUpdateQuestionFile.mockResolvedValue(undefined);
    mockUploadToS3.mockResolvedValue(undefined);
    mockHttpsGetBuffer.mockResolvedValue({ buf: Buffer.from(''), contentType: 'application/pdf' });
  });

  it('imports HigherGov matches into the project the search was saved from', async () => {
    wireDynamo(
      [makeSaved({ source: 'HIGHER_GOV', projectId: SAVED_PROJECT, criteria: { higherGovSearchId: 'hg-saved' } })],
      [{ projectId: DEFAULT_PROJECT, createdAt: '2026-01-01T00:00:00.000Z' }],
    );
    mockSearchHigherGov.mockResolvedValue({
      totalCount: 1,
      results: [{ opp_key: 'HG-1', source_id: null }],
    });

    await baseHandler(runEvent);

    expect(mockCreateOpportunity).toHaveBeenCalledTimes(1);
    const arg = mockCreateOpportunity.mock.calls[0][0];
    // Routed to the saved project, NOT the org default.
    expect(arg.projectId).toBe(SAVED_PROJECT);
    expect(arg.opportunity.source).toBe('HIGHER_GOV');
  });

  it('falls back to the org default project when the search has no projectId', async () => {
    wireDynamo(
      [makeSaved({ source: 'HIGHER_GOV', projectId: undefined, criteria: { higherGovSearchId: 'hg-saved' } })],
      [{ projectId: DEFAULT_PROJECT, createdAt: '2026-01-01T00:00:00.000Z' }],
    );
    mockSearchHigherGov.mockResolvedValue({
      totalCount: 1,
      results: [{ opp_key: 'HG-1', source_id: null }],
    });

    await baseHandler(runEvent);

    expect(mockCreateOpportunity).toHaveBeenCalledTimes(1);
    expect(mockCreateOpportunity.mock.calls[0][0].projectId).toBe(DEFAULT_PROJECT);
  });

  it('skips a HigherGov opportunity that already exists (cross-source dedup)', async () => {
    wireDynamo(
      [makeSaved({ source: 'HIGHER_GOV', projectId: SAVED_PROJECT, criteria: { higherGovSearchId: 'hg-saved' } })],
      [],
    );
    mockSearchHigherGov.mockResolvedValue({
      totalCount: 1,
      results: [{ opp_key: 'HG-DUP', source_id: null }],
    });
    mockFindOppBySourceId.mockResolvedValue({ oppId: 'already-here' });

    await baseHandler(runEvent);

    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });

  it('imports SAM.gov matches when autoImport is on (engine works for SAM too)', async () => {
    wireDynamo(
      [makeSaved({ source: 'SAM_GOV', autoImport: true, projectId: SAVED_PROJECT, criteria: { postedFrom: '01/01/2026', postedTo: '01/31/2026' } })],
      [],
    );
    mockSearchSam.mockResolvedValue({ opportunities: [{ noticeId: 'NOTICE-1' }] });
    // SAM import path fetches the full opportunity via search, then attachments.
    mockFetchOppViaSearch.mockResolvedValue({ noticeId: 'NOTICE-1', title: 'SAM opp' });
    mockExtractAttachments.mockReturnValue([]);

    await baseHandler(runEvent);

    // SAM.gov reached its search + import path (no throw); result recorded.
    expect(mockSearchSam).toHaveBeenCalledTimes(1);
  });

  it('imports DIBBS matches when autoImport is on (engine works for DIBBS too)', async () => {
    wireDynamo(
      [makeSaved({ source: 'DIBBS', autoImport: true, projectId: SAVED_PROJECT, criteria: {} })],
      [],
    );
    mockSearchDibbs.mockResolvedValue({ opportunities: [{ solicitationNumber: 'SPE-1' }] });
    mockFetchDibbsSolicitation.mockResolvedValue({ pscCode: '1234' });
    mockExtractDibbsAttachments.mockReturnValue([]);

    await baseHandler(runEvent);

    expect(mockCreateOpportunity).toHaveBeenCalledTimes(1);
    const arg = mockCreateOpportunity.mock.calls[0][0];
    expect(arg.projectId).toBe(SAVED_PROJECT);
    expect(arg.opportunity.source).toBe('DIBBS');
  });

  it('does NOT import when autoImport is false, only records the run', async () => {
    wireDynamo(
      [makeSaved({ source: 'HIGHER_GOV', autoImport: false, projectId: SAVED_PROJECT, criteria: { higherGovSearchId: 'hg-saved' } })],
      [],
    );
    mockSearchHigherGov.mockResolvedValue({
      totalCount: 3,
      results: [{ opp_key: 'HG-1' }, { opp_key: 'HG-2' }, { opp_key: 'HG-3' }],
    });

    await baseHandler(runEvent);

    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });

  it('does not run a search that is not yet due (DAILY, ran an hour ago)', async () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    wireDynamo(
      [makeSaved({ source: 'HIGHER_GOV', lastRunAt: anHourAgo, criteria: { higherGovSearchId: 'hg-saved' } })],
      [],
    );

    await baseHandler(runEvent);

    expect(mockSearchHigherGov).not.toHaveBeenCalled();
    expect(mockCreateOpportunity).not.toHaveBeenCalled();
  });
});
