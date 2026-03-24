// Mock middy before importing handlers (ESM compatibility)
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
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Mock org-contact helper
const mockGetOrgPrimaryContact = jest.fn();
jest.mock('@/helpers/org-contact', () => ({
  getOrgPrimaryContact: (...args: unknown[]) => mockGetOrgPrimaryContact(...args),
}));

// Mock sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { generateFOIALetter, baseHandler, validateLetterFields } from './generate-foia-letter';
import type { DBFOIARequestItem } from '@/types/project-outcome';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

describe('generate-foia-letter handler', () => {
  describe('generateFOIALetter', () => {
    const mockRequest: DBFOIARequestItem = {
      partition_key: 'FOIA_REQUEST',
      sort_key: 'org-456#proj-123#opp-789#foia-1',
      foiaId: 'foiaId-1',
      id: 'foia-1',
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      agencyName: 'Department of Defense',
      agencyFOIAEmail: 'foia@dod.gov',
      agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
      solicitationNumber: 'W911NF-21-R-0001',
      contractTitle: 'IT Services Contract',
      requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL', 'PRICE_ANALYSIS'],
      customDocumentRequests: [],
      feeLimit: 100,
      companyName: 'Acme Corp',
      awardeeName: 'WinnerCo LLC',
      awardDate: 'January 15, 2026',
      requesterName: 'John Smith',
      requesterTitle: 'Contracts Manager',
      requesterEmail: 'john.smith@company.com',
      requesterPhone: '555-123-4567',
      requesterAddress: '123 Business Ave, Suite 100, Arlington VA 22201',
      requestedBy: 'user-789',
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
      createdBy: 'user-789',
    };

    it('generates letter with correct agency info', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('FOIA Requester Service Center');
      expect(letter).toContain('Department of Defense');
      expect(letter).toContain('1400 Defense Pentagon, Washington DC 20301');
      expect(letter).toContain('foia@dod.gov');
    });

    it('includes FOIA statutory reference', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('Freedom of Information Act (5 U.S.C. Section 552)');
    });

    it('includes solicitation number, title, and award date', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('Solicitation No. W911NF-21-R-0001');
      expect(letter).toContain('titled IT Services Contract');
      expect(letter).toContain('awarded on or about January 15, 2026');
    });

    it('includes company name', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('My company, Acme Corp, submitted a proposal');
    });

    it('includes awardee name', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('The contract was awarded to WinnerCo LLC.');
    });

    it('lists requested documents with numbered descriptions', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('1. Source Selection Evaluation Board (SSEB) report');
      expect(letter).toContain('2. Technical evaluation reports and findings');
      expect(letter).toContain('3. Price/cost analysis documentation');
    });

    it('includes fee limit line when feeLimit > 0', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('$100.00');
      expect(letter).toContain('willing to pay up to');
    });

    it('omits fee line when feeLimit is 0', () => {
      const zeroFeeRequest: DBFOIARequestItem = {
        ...mockRequest,
        feeLimit: 0,
      };

      const letter = generateFOIALetter(zeroFeeRequest);

      expect(letter).not.toContain('willing to pay');
    });

    it('includes requester contact information', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('John Smith');
      expect(letter).toContain('Contracts Manager');
      expect(letter).toContain('Acme Corp');
      expect(letter).toContain('john.smith@company.com');
      expect(letter).toContain('555-123-4567');
      expect(letter).toContain('123 Business Ave, Suite 100, Arlington VA 22201');
    });

    it('includes solicitation and title in pertains line', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('Solicitation No. W911NF-21-R-0001');
      expect(letter).toContain('titled IT Services Contract');
    });

    it('requests PDF delivery format via email', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('responsive records be provided in electronic format (PDF preferred) via email to john.smith@company.com.');
    });

    it('ends with Sincerely closing', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('Sincerely,');
    });

    it('does NOT include old legal sections', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).not.toContain('SEGREGABILITY');
      expect(letter).not.toContain('APPEAL RIGHTS');
      expect(letter).not.toContain('FORMAT OF RECORDS');
      expect(letter).not.toContain('RESPONSE DEADLINE');
      expect(letter).not.toContain('Vaughn index');
      expect(letter).not.toContain('FEE WAIVER REQUEST');
    });

    it('describes requester as unsuccessful offeror', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('unsuccessful offeror');
    });

    it('includes custom document requests', () => {
      const customRequest: DBFOIARequestItem = {
        ...mockRequest,
        customDocumentRequests: [
          'Any emails regarding our proposal evaluation',
          'Meeting minutes from the evaluation board sessions',
        ],
      };

      const letter = generateFOIALetter(customRequest);

      expect(letter).toContain('4. Any emails regarding our proposal evaluation');
      expect(letter).toContain('5. Meeting minutes from the evaluation board sessions');
    });

    it('includes company name in company clause', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('My company, Acme Corp, submitted a proposal');
    });

    it('includes date in the letter', () => {
      const letter = generateFOIALetter(mockRequest);

      // Should contain a date string (month name, day, year)
      expect(letter).toMatch(/\w+ \d{1,2}, \d{4}/);
    });

    it('includes award date in pertains line', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('awarded on or about January 15, 2026');
    });

    it('formats ISO date strings into human-readable format', () => {
      const isoDateRequest: DBFOIARequestItem = {
        ...mockRequest,
        awardDate: '2026-03-22',
      };

      const letter = generateFOIALetter(isoDateRequest);

      expect(letter).toContain('awarded on or about March 22, 2026');
      expect(letter).not.toContain('2026-03-22');
    });

    it('includes awardee name', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('The contract was awarded to WinnerCo LLC.');
    });
  });

  describe('validateLetterFields', () => {
    const completeRequest: DBFOIARequestItem = {
      partition_key: 'FOIA_REQUEST',
      sort_key: 'org-456#proj-123#opp-789#foia-1',
      foiaId: 'foiaId-1',
      id: 'foia-1',
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      agencyName: 'Department of Defense',
      agencyFOIAEmail: 'foia@dod.gov',
      agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
      solicitationNumber: 'W911NF-21-R-0001',
      contractTitle: 'IT Services Contract',
      requestedDocuments: ['SSEB_REPORT'],
      customDocumentRequests: [],
      feeLimit: 0,
      companyName: 'Acme Corp',
      awardDate: 'January 15, 2026',
      requesterName: 'John Smith',
      requesterTitle: 'Contracts Manager',
      requesterEmail: 'john@company.com',
      requesterPhone: '555-123-4567',
      requesterAddress: '123 Business Ave, Arlington VA 22201',
      requestedBy: 'user-789',
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
      createdBy: 'user-789',
    };

    it('returns empty array when all required fields are present', () => {
      expect(validateLetterFields(completeRequest)).toEqual([]);
    });

    it('detects missing requesterTitle', () => {
      const missing = validateLetterFields({ ...completeRequest, requesterTitle: '' });
      expect(missing).toContain('requesterTitle');
    });

    it('detects missing requesterPhone', () => {
      const missing = validateLetterFields({ ...completeRequest, requesterPhone: '' });
      expect(missing).toContain('requesterPhone');
    });

    it('detects empty requestedDocuments', () => {
      const missing = validateLetterFields({ ...completeRequest, requestedDocuments: [] });
      expect(missing).toContain('requestedDocuments');
    });

    it('detects multiple missing fields', () => {
      const missing = validateLetterFields({
        ...completeRequest,
        agencyName: '',
        requesterName: '',
        companyName: '',
      });
      expect(missing).toContain('agencyName');
      expect(missing).toContain('requesterName');
      expect(missing).toContain('companyName');
      expect(missing).toHaveLength(3);
    });
  });

  describe('baseHandler', () => {
    const mockRequest: DBFOIARequestItem = {
      partition_key: 'FOIA_REQUEST',
      sort_key: 'org-456#proj-123#opp-789#foia-1',
      foiaId: 'foiaId-1',
      id: 'foia-1',
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      agencyName: 'Department of Defense',
      agencyFOIAEmail: 'foia@dod.gov',
      agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
      solicitationNumber: 'W911NF-21-R-0001',
      contractTitle: 'IT Services Contract',
      requestedDocuments: ['SSEB_REPORT'],
      customDocumentRequests: [],
      feeLimit: 0,
      companyName: 'Acme Corp',
      awardDate: 'January 15, 2026',
      requesterName: 'John Smith',
      requesterTitle: 'Contracts Manager',
      requesterEmail: 'john@company.com',
      requesterPhone: '555-123-4567',
      requesterAddress: '123 Business Ave, Arlington VA 22201',
      requestedBy: 'user-789',
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
      createdBy: 'user-789',
    };

    beforeEach(() => {
      mockSend.mockReset();
      mockGetOrgPrimaryContact.mockReset();
    });

    const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
      ({
        body: JSON.stringify(body),
      }) as unknown as APIGatewayProxyEventV2;

    it('returns 400 for invalid payload', async () => {
      const result = await baseHandler(makeEvent({}));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Invalid payload');
    });

    it('returns 404 when FOIA request is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockGetOrgPrimaryContact.mockResolvedValue(null);

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'nonexistent',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(404);
      expect(parsed.message).toBe('FOIA request not found');
    });

    it('returns 200 with generated letter on success', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockRequest });
      mockGetOrgPrimaryContact.mockResolvedValue(null);

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-1',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(parsed.letter).toContain('Freedom of Information Act');
      expect(parsed.letter).toContain('Acme Corp');
    });

    it('uses correct DynamoDB key for the GetCommand', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockRequest });
      mockGetOrgPrimaryContact.mockResolvedValue(null);

      await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-1',
      }));

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.type).toBe('Get');
      expect(getCall.params.Key.partition_key).toBe('FOIA_REQUEST');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789#foia-1');
    });

    it('enriches missing requester fields from primary contact', async () => {
      const requestMissingContact: DBFOIARequestItem = {
        ...mockRequest,
        requesterName: '',
        requesterEmail: '',
        requesterPhone: undefined,
        requesterAddress: undefined,
      };

      mockSend.mockResolvedValueOnce({ Item: requestMissingContact });
      mockGetOrgPrimaryContact.mockResolvedValue({
        name: 'Org Contact',
        email: 'contact@org.com',
        phone: '555-999-0000',
        address: '456 Corp Blvd, DC 20001',
      });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-1',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(parsed.letter).toContain('Org Contact');
      expect(parsed.letter).toContain('contact@org.com');
      expect(parsed.letter).toContain('555-999-0000');
      expect(parsed.letter).toContain('456 Corp Blvd, DC 20001');
    });

    it('does not overwrite existing requester fields with primary contact', async () => {
      const requestWithAllContactFields: DBFOIARequestItem = {
        ...mockRequest,
        requesterPhone: '555-123-4567',
        requesterAddress: '123 Existing Ave, Arlington VA 22201',
      };

      mockSend.mockResolvedValueOnce({ Item: requestWithAllContactFields });
      mockGetOrgPrimaryContact.mockResolvedValue({
        name: 'Should Not Appear',
        email: 'shouldnot@org.com',
        phone: '555-000-0000',
        address: 'Should Not Appear Address',
      });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-1',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(parsed.letter).toContain('John Smith');
      expect(parsed.letter).toContain('john@company.com');
      expect(parsed.letter).toContain('555-123-4567');
      expect(parsed.letter).toContain('123 Existing Ave, Arlington VA 22201');
      expect(parsed.letter).not.toContain('Should Not Appear');
    });

    it('returns 400 when required letter fields are missing', async () => {
      const incompleteFOIA: DBFOIARequestItem = {
        ...mockRequest,
        requesterTitle: '',
        requesterPhone: '',
      };

      mockSend.mockResolvedValueOnce({ Item: incompleteFOIA });
      mockGetOrgPrimaryContact.mockResolvedValue(null);

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-1',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('missing required fields');
      expect(parsed.missingFields).toContain('requesterTitle');
      expect(parsed.missingFields).toContain('requesterPhone');
    });

    it('handles primary contact fetch failure gracefully', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockRequest });
      mockGetOrgPrimaryContact.mockRejectedValue(new Error('Contact service down'));

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-1',
      }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(parsed.letter).toContain('John Smith');
    });
  });
});
