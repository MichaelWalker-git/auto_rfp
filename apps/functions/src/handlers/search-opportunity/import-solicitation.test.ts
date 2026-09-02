/**
 * import-solicitation.test.ts
 *
 * Tests for the unified import-solicitation handler (SAM_GOV, DIBBS, HIGHER_GOV, MANUAL_UPLOAD).
 */

// Mock middy before imports
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.HIGHERGOV_BASE_URL = 'https://api.highergov.test';
process.env.DIBBS_BASE_URL = 'https://dibbs.test';

// Mock helper modules
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: jest.fn(),
}));

jest.mock('@/helpers/opportunity', () => ({
  createOpportunity: jest.fn(),
  findOpportunityBySourceId: jest.fn(),
}));

jest.mock('@/helpers/apn-db', () => ({
  syncOpportunityToApn: jest.fn(),
}));

jest.mock('@/helpers/attachment-importer', () => ({
  importAttachments: jest.fn(),
  isSafeUrlAsync: jest.fn(),
}));

jest.mock('@/helpers/send-notification', () => ({
  sendNotification: jest.fn(),
  buildNotification: jest.fn((type, title, msg, opts) => ({ type, title, msg, ...opts })),
}));

jest.mock('@/helpers/resolve-users', () => ({
  resolveUserNames: jest.fn(),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  setAuditContext: jest.fn(),
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
}));

// Only fake the network-calling exports; keep everything else (safeIsoOrNull,
// toBoolActive, sha1, httpsGetBuffer, DIBBS/HigherGov helpers) real.
jest.mock('@/helpers/search-opportunity', () => ({
  ...jest.requireActual('@/helpers/search-opportunity'),
  fetchOpportunityViaSearch: jest.fn(),
  extractAttachmentsFromOpportunity: jest.fn(),
}));

// Import after mocks
import { baseHandler } from './import-solicitation';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { createOpportunity } from '@/helpers/opportunity';
import { importAttachments, isSafeUrlAsync } from '@/helpers/attachment-importer';
import { syncOpportunityToApn } from '@/helpers/apn-db';
import { sendNotification } from '@/helpers/send-notification';
import { resolveUserNames } from '@/helpers/resolve-users';
import { setAuditContext } from '@/middleware/audit-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { fetchOpportunityViaSearch, extractAttachmentsFromOpportunity } from '@/helpers/search-opportunity';
import * as ExecutiveOpportunityBrief from '@/helpers/executive-opportunity-brief';

const mockCreateOpportunity = createOpportunity as jest.MockedFunction<typeof createOpportunity>;
const mockImportAttachments = importAttachments as jest.MockedFunction<typeof importAttachments>;
const mockIsSafeUrlAsync = isSafeUrlAsync as jest.MockedFunction<typeof isSafeUrlAsync>;
const mockSyncOpportunityToApn = syncOpportunityToApn as jest.MockedFunction<typeof syncOpportunityToApn>;
const mockSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;
const mockResolveUserNames = resolveUserNames as jest.MockedFunction<typeof resolveUserNames>;
const mockSetAuditContext = setAuditContext as jest.MockedFunction<typeof setAuditContext>;
const mockGetApiKey = getApiKey as jest.MockedFunction<typeof getApiKey>;
const mockFetchOpportunityViaSearch = fetchOpportunityViaSearch as jest.MockedFunction<typeof fetchOpportunityViaSearch>;
const mockExtractAttachmentsFromOpportunity = extractAttachmentsFromOpportunity as jest.MockedFunction<typeof extractAttachmentsFromOpportunity>;

const buildMockEvent = (body: unknown): AuthedEvent => ({
  body: JSON.stringify(body),
  headers: {},
  requestContext: {} as any,
  isBase64Encoded: false,
  auth: { userId: 'user-123', userName: 'Test User', orgId: 'org-123' },
  rbac: { role: 'admin', permissions: new Set(['opportunity:create', 'question:create']) },
} as AuthedEvent);

describe('import-solicitation — MANUAL_UPLOAD', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockResolveUserNames.mockResolvedValue({ 'user-123': 'Test User' });
    mockSyncOpportunityToApn.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);
  });

  it('should successfully import from a valid URL', async () => {
    const url = 'https://example.com/solicitation.pdf';
    const event = buildMockEvent({
      source: 'MANUAL_UPLOAD',
      orgId: 'org-123',
      projectId: 'proj-456',
      url,
      title: 'Test Solicitation',
    });

    mockIsSafeUrlAsync.mockResolvedValue(true);
    mockCreateOpportunity.mockResolvedValue({
      oppId: 'opp-789',
      item: {
        oppId: 'opp-789',
        orgId: 'org-123',
        projectId: 'proj-456',
        source: 'MANUAL_UPLOAD',
        id: 'manual-solicitation.pdf-12345',
        title: 'Test Solicitation',
        sourceUrl: url,
      } as any,
    });
    mockImportAttachments.mockResolvedValue([
      { questionFileId: 'qf-1', fileKey: 'key-1', executionArn: 'arn:1' },
    ]);

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(body.ok).toBe(true);
    expect(body.source).toBe('MANUAL_UPLOAD');
    expect(body.opportunityId).toBe('opp-789');
    expect(body.imported).toBe(1);
    expect(body.limitedMetadata).toBe(true);

    expect(mockIsSafeUrlAsync).toHaveBeenCalledWith(url);
    expect(mockCreateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunity: expect.objectContaining({
          source: 'MANUAL_UPLOAD',
          title: 'Test Solicitation',
          sourceUrl: url,
        }),
      }),
    );
    expect(mockImportAttachments).toHaveBeenCalledWith({
      orgId: 'org-123',
      projectId: 'proj-456',
      id: expect.stringMatching(/^manual-/),
      attachments: [{ url }],
      oppId: 'opp-789',
      sourceDocumentId: undefined,
    });
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        action: 'SOLICITATION_IMPORTED',
        resource: 'opportunity',
        resourceId: 'opp-789',
        orgId: 'org-123',
      }),
    );
    expect(mockSendNotification).toHaveBeenCalled();
  });

  it('should reject SSRF-blocked URLs', async () => {
    const url = 'https://169.254.169.254/latest/meta-data/';
    const event = buildMockEvent({
      source: 'MANUAL_UPLOAD',
      orgId: 'org-123',
      projectId: 'proj-456',
      url,
    });

    mockIsSafeUrlAsync.mockResolvedValue(false);

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('Invalid or unsafe URL');
    expect(body.url).toBe(url);

    expect(mockIsSafeUrlAsync).toHaveBeenCalledWith(url);
    expect(mockCreateOpportunity).not.toHaveBeenCalled();
    expect(mockImportAttachments).not.toHaveBeenCalled();
  });

  it('should handle download failure gracefully (zero files imported)', async () => {
    const url = 'https://example.com/missing.pdf';
    const event = buildMockEvent({
      source: 'MANUAL_UPLOAD',
      orgId: 'org-123',
      projectId: 'proj-456',
      url,
    });

    mockIsSafeUrlAsync.mockResolvedValue(true);
    mockCreateOpportunity.mockResolvedValue({
      oppId: 'opp-789',
      item: {
        oppId: 'opp-789',
        orgId: 'org-123',
        projectId: 'proj-456',
        source: 'MANUAL_UPLOAD',
        id: 'manual-missing.pdf-12345',
        title: 'Manual Upload',
        sourceUrl: url,
      } as any,
    });
    // importAttachments returns empty array on download failure
    mockImportAttachments.mockResolvedValue([]);

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(body.ok).toBe(true);
    expect(body.imported).toBe(0);
    expect(body.files).toEqual([]);

    expect(mockCreateOpportunity).toHaveBeenCalled();
    expect(mockImportAttachments).toHaveBeenCalled();
  });

  it('should derive title from URL when not provided', async () => {
    const url = 'https://example.com/documents/RFP-2024-ABC.pdf';
    const event = buildMockEvent({
      source: 'MANUAL_UPLOAD',
      orgId: 'org-123',
      projectId: 'proj-456',
      url,
      // No title provided
    });

    mockIsSafeUrlAsync.mockResolvedValue(true);
    mockCreateOpportunity.mockResolvedValue({
      oppId: 'opp-789',
      item: {
        oppId: 'opp-789',
        orgId: 'org-123',
        projectId: 'proj-456',
        source: 'MANUAL_UPLOAD',
        id: 'manual-RFP-2024-ABC.pdf-12345',
        title: 'RFP 2024 ABC',
        sourceUrl: url,
      } as any,
    });
    mockImportAttachments.mockResolvedValue([]);

    await baseHandler(event);

    expect(mockCreateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({
          title: 'RFP 2024 ABC',
        }),
      }),
    );
  });

  it('should reject invalid URL format', async () => {
    const event = buildMockEvent({
      source: 'MANUAL_UPLOAD',
      orgId: 'org-123',
      projectId: 'proj-456',
      url: 'not-a-valid-url',
    });

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Validation error');
    expect(body.issues).toBeDefined();
  });

  it('should include sourceDocumentId when provided', async () => {
    const url = 'https://example.com/doc.pdf';
    const event = buildMockEvent({
      source: 'MANUAL_UPLOAD',
      orgId: 'org-123',
      projectId: 'proj-456',
      url,
      sourceDocumentId: 'parent-doc-123',
    });

    mockIsSafeUrlAsync.mockResolvedValue(true);
    mockCreateOpportunity.mockResolvedValue({
      oppId: 'opp-789',
      item: { oppId: 'opp-789', source: 'MANUAL_UPLOAD', title: 'Manual Upload' } as any,
    });
    mockImportAttachments.mockResolvedValue([]);

    await baseHandler(event);

    expect(mockImportAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDocumentId: 'parent-doc-123',
      }),
    );
  });
});

describe('import-solicitation — SAM_GOV physical submission scan', () => {
  const buildSamGovEvent = (overrides: Record<string, unknown> = {}) =>
    buildMockEvent({
      source: 'SAM_GOV',
      orgId: 'org-123',
      projectId: 'proj-456',
      noticeId: 'notice-1',
      postedFrom: '01/01/2026',
      postedTo: '01/31/2026',
      force: true,
      ...overrides,
    });

  const PHYSICAL_DESCRIPTION =
    'Sealed proposals must be submitted in hard copy. Mail proposals to the following address:\n' +
    '123 Main Street\nSuite 400\nWashington, DC 20001';
  const NO_INDICATOR_DESCRIPTION =
    'This is a standard IT services solicitation for software development support.';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetApiKey.mockResolvedValue('sam-api-key');
    mockExtractAttachmentsFromOpportunity.mockReturnValue([]);
    mockSyncOpportunityToApn.mockResolvedValue(undefined);
    mockImportAttachments.mockResolvedValue([]);
    mockResolveUserNames.mockResolvedValue({ 'user-123': 'Test User' });
    mockSendNotification.mockResolvedValue(undefined);
    mockCreateOpportunity.mockImplementation(async ({ opportunity }) => ({
      oppId: 'opp-789',
      item: { oppId: 'opp-789', ...opportunity } as any,
    }));
  });

  it('calls scanPhysicalSubmission during import', async () => {
    const scanSpy = jest.spyOn(ExecutiveOpportunityBrief, 'scanPhysicalSubmission');
    mockFetchOpportunityViaSearch.mockResolvedValue({
      title: 'IT Support Services',
      description: PHYSICAL_DESCRIPTION,
    });

    await baseHandler(buildSamGovEvent());

    expect(scanSpy).toHaveBeenCalledWith(expect.stringContaining('Mail proposals to'));
  });

  it('stores submissionMethod, submissionMailingAddress, and submissionMethodRationale when the description contains physical submission language', async () => {
    mockFetchOpportunityViaSearch.mockResolvedValue({
      title: 'IT Support Services',
      description: PHYSICAL_DESCRIPTION,
    });

    await baseHandler(buildSamGovEvent());

    expect(mockCreateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({
          submissionMethod: 'PHYSICAL',
          submissionMailingAddress: expect.objectContaining({
            locality: 'Washington',
            administrativeArea: 'DC',
            postalCode: '20001',
          }),
          submissionMethodRationale: expect.stringContaining('Mail proposals to'),
        }),
      }),
    );
  });

  it('stores the opportunity without submission fields when the description has no indicators', async () => {
    mockFetchOpportunityViaSearch.mockResolvedValue({
      title: 'IT Support Services',
      description: NO_INDICATOR_DESCRIPTION,
    });

    await baseHandler(buildSamGovEvent());

    const call = mockCreateOpportunity.mock.calls[0][0];
    expect(call.opportunity).not.toHaveProperty('submissionMethod');
    expect(call.opportunity).not.toHaveProperty('submissionMailingAddress');
    expect(call.opportunity).not.toHaveProperty('submissionMethodRationale');
  });

  it('does not fail the import when the scanner throws', async () => {
    const scanSpy = jest
      .spyOn(ExecutiveOpportunityBrief, 'scanPhysicalSubmission')
      .mockImplementation(() => {
        throw new Error('scanner exploded');
      });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetchOpportunityViaSearch.mockResolvedValue({
      title: 'IT Support Services',
      description: PHYSICAL_DESCRIPTION,
    });

    const result = await baseHandler(buildSamGovEvent());

    expect(result.statusCode).toBe(202);
    expect(mockCreateOpportunity).toHaveBeenCalled();
    const call = mockCreateOpportunity.mock.calls[0][0];
    expect(call.opportunity).not.toHaveProperty('submissionMethod');
    expect(warnSpy).toHaveBeenCalled();

    scanSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
