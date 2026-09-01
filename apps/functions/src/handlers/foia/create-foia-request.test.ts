// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// Mock other modules
jest.mock('@/helpers/api', () => ({
  apiResponse: jest.fn((statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler) => handler,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(),
  httpErrorMiddleware: jest.fn(),
  orgMembershipMiddleware: jest.fn(),
  requirePermission: jest.fn(),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(),
  setAuditContext: jest.fn(),
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn().mockReturnValue('test-table'),
}));

jest.mock('@/helpers/db', () => ({
  docClient: { send: mockSend },
}));

jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: jest.fn(),
}));

jest.mock('@/helpers/portal-detection', () => ({
  detectAgencyPortal: jest.fn(),
  getAgencyName: jest.fn((agencyInfo) => agencyInfo.trim()),
}));

jest.mock('@/helpers/agency-scraper', () => ({
  findAgencyRecordsPage: jest.fn(),
  scrapeAgencyContactInfo: jest.fn(),
}));

// Import the handlers after all mocks are set up
import { baseHandler, createFOIARequest } from './create-foia-request';
import { CreateFOIARequest } from '@auto-rfp/core';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { detectAgencyPortal } from '@/helpers/portal-detection';
import { findAgencyRecordsPage, scrapeAgencyContactInfo } from '@/helpers/agency-scraper';
import { setAuditContext } from '@/middleware/audit-middleware';
import { getOpportunity } from '@/helpers/opportunity';

const validDto: CreateFOIARequest = {
  projectId: 'proj-123',
  orgId: 'org-456',
  opportunityId: 'opp-789',
  agencyName: 'Department of Defense',
  agencyDomain: 'dod.govqa.us',
  agencyFOIAEmail: 'foia@dod.gov',
  agencyFOIAAddress: '1400 Defense Pentagon, Washington DC',
  solicitationNumber: 'W911NF-21-R-0001',
  contractTitle: 'IT Services Contract',
  requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL'],
  requesterName: 'John Doe',
  requesterTitle: 'Contracts Manager',
  requesterEmail: 'john@company.com',
  requesterPhone: '555-123-4567',
  requesterAddress: '123 Main St, City ST 12345',
  companyName: 'Acme Corp',
  awardeeName: 'WinnerCo LLC',
  awardDate: 'January 15, 2026',
};

describe('create-foia-request handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();

    // Default mock implementations
    (detectAgencyPortal as jest.Mock).mockResolvedValue({
      detected: false,
      type: 'Unknown',
      baseUrl: '',
    });
    (findAgencyRecordsPage as jest.Mock).mockResolvedValue(null);
    (scrapeAgencyContactInfo as jest.Mock).mockResolvedValue({});
    (getOpportunity as jest.Mock).mockResolvedValue({
      item: { status: 'WON' }
    });
  });

  describe('createFOIARequest', () => {
    it('creates FOIA request with correct structure', async () => {
      mockSend.mockResolvedValue({});

      const result = await createFOIARequest(validDto, 'user-789');

      expect(result.partition_key).toBe('FOIA_REQUEST');
      expect(result.sort_key).toBe('org-456#proj-123#opp-789#mock-uuid');
      expect(result.foiaId).toBe('mock-uuid');
      expect(result.agencyName).toBe('Department of Defense');
      expect(result.requestedDocuments).toEqual(['SSEB_REPORT', 'TECHNICAL_EVAL']);
    });

    it('does not include status or deadline fields', async () => {
      mockSend.mockResolvedValue({});

      const result = await createFOIARequest(validDto, 'user-789');

      expect(result).not.toHaveProperty('status');
      expect(result).not.toHaveProperty('statusHistory');
      expect(result).not.toHaveProperty('responseDeadline');
      expect(result).not.toHaveProperty('autoSubmitAttempted');
      expect(result).not.toHaveProperty('generatedLetterS3Key');
      expect(result).not.toHaveProperty('generatedLetterVersion');
    });

    it('stores all fields in the DynamoDB item', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        agencyName: 'Department of Veterans Affairs',
        agencyFOIAEmail: 'foia@va.gov',
        agencyFOIAAddress: '810 Vermont Ave NW, Washington DC',
        solicitationNumber: 'VA-123-21-R-0001',
        contractTitle: 'VA IT Modernization',
        requestedDocuments: ['SSEB_REPORT', 'PRICE_ANALYSIS', 'PAST_PERFORMANCE_EVAL'],
        requesterName: 'Bob Johnson',
        requesterTitle: 'VP Contracts',
        requesterEmail: 'bob@company.com',
        requesterPhone: '555-123-4567',
        requesterAddress: '123 Main St, City, ST 12345',
        companyName: 'Johnson Corp',
        awardeeName: 'WinnerCo LLC',
        awardDate: 'March 1, 2026',
        feeLimit: 100,
      };

      const result = await createFOIARequest(dto, 'user-789');

      expect(result.agencyFOIAAddress).toBe('810 Vermont Ave NW, Washington DC');
      expect(result.contractTitle).toBe('VA IT Modernization');
      expect(result.requesterPhone).toBe('555-123-4567');
      expect(result.requesterAddress).toBe('123 Main St, City, ST 12345');
      expect(result.companyName).toBe('Johnson Corp');
      expect(result.awardeeName).toBe('WinnerCo LLC');
      expect(result.awardDate).toBe('March 1, 2026');
    });

    it('sets createdBy to current user', async () => {
      mockSend.mockResolvedValue({});

      const result = await createFOIARequest(validDto, 'user-abc-123');

      expect(result.createdBy).toBe('user-abc-123');
    });

    it('stores contractTitle from DTO', async () => {
      mockSend.mockResolvedValue({});

      const result = await createFOIARequest(validDto, 'user-789');

      expect(result.contractTitle).toBe('IT Services Contract');
    });

    it('calls DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValue({});

      await createFOIARequest(validDto, 'user-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
          }),
        })
      );
    });
  });

  const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 & { authContext?: { userId?: string } } =>
    ({
      body: JSON.stringify(body),
      authContext: { userId: 'user-789' },
    }) as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };

  describe('baseHandler — checkEligibleOutcome guard', () => {
    const validBody = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      agencyName: 'Test Agency',
      agencyFOIAEmail: 'foia@test.gov',
      agencyFOIAAddress: '100 Test St, Washington DC',
      solicitationNumber: 'TEST-001',
      contractTitle: 'Test Contract',
      requestedDocuments: ['SSDD'],
      requesterName: 'Test User',
      requesterTitle: 'Test Title',
      requesterEmail: 'test@example.com',
      requesterPhone: '555-000-0000',
      requesterAddress: '100 Test Ave, City ST 12345',
      companyName: 'Test Corp',
      awardeeName: 'Winner Inc',
      awardDate: 'January 1, 2026',
    };

    it('returns 400 when no outcome item exists', async () => {
      (getOpportunity as jest.Mock).mockResolvedValueOnce({ item: undefined });

      const result = await baseHandler(makeEvent(validBody));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('WON or LOST');
    });

    it('returns 400 when outcome exists but is SUBMITTED', async () => {
      (getOpportunity as jest.Mock).mockResolvedValueOnce({
        item: { status: 'SUBMITTED' },
      });

      const result = await baseHandler(makeEvent(validBody));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('WON or LOST');
    });

    it('returns 400 when outcome exists but is NO_BID', async () => {
      (getOpportunity as jest.Mock).mockResolvedValueOnce({
        item: { status: 'NO_BID' },
      });

      const result = await baseHandler(makeEvent(validBody));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('WON or LOST');
    });

    it('returns 400 when outcome exists but is WITHDRAWN', async () => {
      (getOpportunity as jest.Mock).mockResolvedValueOnce({
        item: { status: 'WITHDRAWN' },
      });

      const result = await baseHandler(makeEvent(validBody));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('WON or LOST');
    });

    it('allows creation (201) when outcome has status LOST', async () => {
      // First call: GetCommand for checkEligibleOutcome
      mockSend.mockResolvedValueOnce({
        Item: { status: 'LOST' },
      });
      // Second call: PutCommand for createFOIARequest
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(makeEvent(validBody));

      expect(result.statusCode).toBe(201);
    });

    it('allows creation (201) when outcome has status WON', async () => {
      // First call: GetCommand for checkEligibleOutcome
      mockSend.mockResolvedValueOnce({
        Item: { status: 'WON' },
      });
      // Second call: PutCommand for createFOIARequest
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(makeEvent(validBody));

      expect(result.statusCode).toBe(201);
    });

    it('looks up the opportunity with the full 3-part parameters', async () => {
      mockSend.mockResolvedValueOnce({});

      await baseHandler(makeEvent(validBody));

      expect(getOpportunity).toHaveBeenCalledWith({
        orgId: 'org-456',
        projectId: 'proj-123',
        oppId: 'opp-789'
      });
    });

    it('returns 400 when body is missing', async () => {
      const event = { body: undefined, authContext: { userId: 'user-789' } } as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };
      const result = await baseHandler(event);
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Request body is missing');
    });

    it('returns 400 for invalid JSON', async () => {
      const event = { body: 'not-json{', authContext: { userId: 'user-789' } } as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };
      const result = await baseHandler(event);
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Invalid JSON in request body');
    });

    it('returns 400 for validation errors (missing required fields)', async () => {
      const result = await baseHandler(makeEvent({
        projectId: 'proj-123',
        orgId: 'org-456',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Validation failed');
      expect(parsed.errors.length).toBeGreaterThan(0);
    });

    it('defaults userId to unknown when authContext is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: { status: 'LOST' } });
      mockSend.mockResolvedValueOnce({});

      const event = {
        body: JSON.stringify(validBody),
      } as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body as string);
      expect(parsed.foiaRequest.createdBy).toBe('unknown');
    });
  });

  describe('Portal detection integration', () => {
    it('adds portal detection fields when portal is detected', async () => {
      mockSend.mockResolvedValue({});

      // Pass a DTO that already has portal information (as baseHandler would populate it)
      const dtoWithPortalInfo = {
        ...validDto,
        agencyDomain: 'dod.govqa.us',
        portalDetected: true,
        portalType: 'GovQA' as const,
        portalBaseUrl: 'https://dod.govqa.us',
        portalRecordTypeField: 'type_of_record_requested',
        portalRecordTypeValue: 'Department of Defense'
      };

      const result = await createFOIARequest(dtoWithPortalInfo, 'user-789');

      expect(result.portalDetected).toBe(true);
      expect(result.portalType).toBe('GovQA');
      expect(result.portalBaseUrl).toBe('https://dod.govqa.us');
      expect(result.portalRecordTypeField).toBe('type_of_record_requested');
      expect(result.portalRecordTypeValue).toBe('Department of Defense');
    });

    it('stores updated agencyFOIAEmail from DTO', async () => {
      mockSend.mockResolvedValue({});

      // Pass a DTO with updated email (as baseHandler would populate it after scraping)
      const dtoWithUpdatedEmail = {
        ...validDto,
        agencyFOIAEmail: 'newrecords@dod.gov',
        portalDetected: false,
        portalType: 'Unknown' as const,
        portalBaseUrl: ''
      };

      const result = await createFOIARequest(dtoWithUpdatedEmail, 'user-789');

      expect(result.portalDetected).toBe(false);
      expect(result.agencyFOIAEmail).toBe('newrecords@dod.gov');
    });

    it('detects portal and sets audit log with PORTAL_DETECTED action', async () => {
      // First call: GetCommand for checkEligibleOutcome
      mockSend.mockResolvedValueOnce({
        Item: { status: 'WON' },
      });
      // Second call: PutCommand for createFOIARequest
      mockSend.mockResolvedValueOnce({});
      
      // Mock portal detection for GovQA portal
      (detectAgencyPortal as jest.Mock).mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://dod.govqa.us',
        recordTypeField: 'type_of_record_requested',
        recordTypeValue: 'Department of Defense'
      });
      
      // Mock audit context
      const mockSetAuditContext = jest.fn();
      (setAuditContext as jest.Mock).mockImplementation(mockSetAuditContext);

      const result = await baseHandler(makeEvent(validDto));

      expect(result.statusCode).toBe(201);
      expect(detectAgencyPortal).toHaveBeenCalledWith('Department of Defense', 'dod.govqa.us');
      expect(mockSetAuditContext).toHaveBeenCalledWith(
        expect.anything(),
        {
          action: 'PORTAL_DETECTED',
          resource: 'foia_request',
          resourceId: 'mock-uuid',
          changes: {
            after: {
              portalDetected: true,
              portalType: 'GovQA',
              portalBaseUrl: 'https://dod.govqa.us',
              agencyName: 'Department of Defense',
            },
          },
        }
      );
    });

    it('falls back to email scraping and sets audit log with EMAIL_FALLBACK_INITIATED action', async () => {
      // First call: GetCommand for checkEligibleOutcome
      mockSend.mockResolvedValueOnce({
        Item: { status: 'WON' },
      });
      // Second call: PutCommand for createFOIARequest
      mockSend.mockResolvedValueOnce({});
      
      // Mock portal detection to find no portal
      (detectAgencyPortal as jest.Mock).mockResolvedValue({
        detected: false,
        type: 'Unknown',
        baseUrl: '',
        recordTypeField: undefined,
        recordTypeValue: undefined
      });
      
      // Mock finding records page
      (findAgencyRecordsPage as jest.Mock).mockResolvedValueOnce('https://www.dod.gov/records');
      
      // Mock scraping contact info
      (scrapeAgencyContactInfo as jest.Mock).mockResolvedValueOnce({
        coordinatorEmail: 'newrecords@dod.gov',
        statutoryCitation: 'Department of Defense Public Records Act'
      });
      
      // Mock audit context
      const mockSetAuditContext = jest.fn();
      (setAuditContext as jest.Mock).mockImplementation(mockSetAuditContext);

      const result = await baseHandler(makeEvent(validDto));

      expect(result.statusCode).toBe(201);
      expect(detectAgencyPortal).toHaveBeenCalledWith('Department of Defense', 'dod.govqa.us');
      expect(findAgencyRecordsPage).toHaveBeenCalledWith('Department of Defense');
      expect(scrapeAgencyContactInfo).toHaveBeenCalledWith('Department of Defense', 'https://www.dod.gov/records');
      expect(mockSetAuditContext).toHaveBeenCalledWith(
        expect.anything(),
        {
          action: 'EMAIL_FALLBACK_INITIATED',
          resource: 'foia_request',
          resourceId: 'mock-uuid',
          changes: {
            after: {
              portalDetected: false,
              portalType: 'Unknown',
              portalBaseUrl: '',
              agencyName: 'Department of Defense',
            },
          },
        }
      );
    });

    it('updates agencyFOIAEmail with scraped contact info when portal is not detected', async () => {
      mockSend.mockResolvedValueOnce({});

      // Mock portal detection to find no portal
      (detectAgencyPortal as jest.Mock).mockResolvedValue({
        detected: false,
        type: 'Unknown',
        baseUrl: '',
        recordTypeField: undefined,
        recordTypeValue: undefined
      });

      // Mock finding records page
      (findAgencyRecordsPage as jest.Mock).mockResolvedValueOnce('https://www.dod.gov/records');

      // Mock scraping contact info with new email
      (scrapeAgencyContactInfo as jest.Mock).mockResolvedValueOnce({
        coordinatorEmail: 'newrecords@dod.gov',
      });

      const validBodyWithDifferentEmail = { ...validDto, agencyFOIAEmail: 'oldemail@dod.gov' };
      const result = await baseHandler(makeEvent(validBodyWithDifferentEmail));

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body as string);
      expect(parsed.foiaRequest.agencyFOIAEmail).toBe('newrecords@dod.gov');
    });
  });
});
