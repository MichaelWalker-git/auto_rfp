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

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { generateFOIALetter } from './generate-foia-letter';
import type { DBFOIARequestItem } from '@/types/project-outcome';

describe('generate-foia-letter handler', () => {
  describe('generateFOIALetter', () => {
    const mockRequest: DBFOIARequestItem = {
      partition_key: 'FOIA_REQUEST',
      sort_key: 'org-456#proj-123#foia-1',
      foiaId: 'foiaId-1',
      id: 'foia-1',
      projectId: 'proj-123',
      orgId: 'org-456',
      status: 'DRAFT',
      agencyId: 'agency-1',
      agencyName: 'Department of Defense',
      agencyAbbreviation: 'DoD',
      agencyFOIAEmail: 'foia@dod.gov',
      agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
      solicitationNumber: 'W911NF-21-R-0001',
      contractTitle: 'IT Services Contract',
      contractNumber: 'W911NF-21-C-0001',
      requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL', 'PRICE_ANALYSIS'],
      feeLimit: 100,
      companyName: 'Acme Corp',
      samUEI: 'ABC123DEF456',
      awardeeName: 'WinnerCo LLC',
      awardDate: 'January 15, 2026',
      requesterName: 'John Smith',
      requesterEmail: 'john.smith@company.com',
      requesterPhone: '555-123-4567',
      requesterAddress: '123 Business Ave, Suite 100, Arlington VA 22201',
      requestedBy: 'user-789',
      statusHistory: [],
      autoSubmitAttempted: false,
      generatedLetterS3Key: 's3://bucket/letter-1',
      generatedLetterVersion: 1,
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
      expect(letter).toContain('awarded on or around January 15, 2026');
    });

    it('includes company name and SAM UEI', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('My company, Acme Corp (SAM UEI: ABC123DEF456)');
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
      expect(letter).toContain('john.smith@company.com');
      expect(letter).toContain('555-123-4567');
      expect(letter).toContain('123 Business Ave, Suite 100, Arlington VA 22201');
    });

    it('includes email for electronic delivery', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('electronic delivery of responsive records: john.smith@company.com');
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

    it('works without optional company/awardee fields', () => {
      const minimalRequest: DBFOIARequestItem = {
        partition_key: 'FOIA_REQUEST',
        sort_key: 'org-456#proj-123#foia-2',
        id: 'foia-2',
        projectId: 'proj-123',
        orgId: 'org-456',
        foiaId: 'foiaId-2',
        status: 'DRAFT',
        agencyId: 'agency-1',
        agencyName: 'GSA',
        agencyAbbreviation: 'GSA',
        solicitationNumber: 'GS-00F-0001',
        contractTitle: 'IT Services',
        requestedDocuments: ['SSDD'],
        feeLimit: 0,
        requesterName: 'Jane Doe',
        requesterEmail: 'jane@example.com',
        requestedBy: 'user-789',
        statusHistory: [],
        autoSubmitAttempted: false,
        generatedLetterS3Key: 's3-key',
        generatedLetterVersion: 1,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        createdBy: 'user-789',
      };

      const letter = generateFOIALetter(minimalRequest);

      expect(letter).toContain('GSA');
      expect(letter).toContain('Jane Doe');
      expect(letter).toContain('jane@example.com');
      expect(letter).toContain('Source Selection Decision Document');
      // Should use fallback "I submitted a proposal" without company name
      expect(letter).toContain('I submitted a proposal');
      expect(letter).not.toContain('My company');
      // No fee line when feeLimit is 0
      expect(letter).not.toContain('willing to pay');
    });

    it('includes company name without UEI when UEI is missing', () => {
      const noUEIRequest: DBFOIARequestItem = {
        ...mockRequest,
        companyName: 'Test Corp',
        samUEI: undefined,
      };

      const letter = generateFOIALetter(noUEIRequest);

      expect(letter).toContain('My company, Test Corp, submitted a proposal');
      expect(letter).not.toContain('SAM UEI');
    });

    it('includes date in the letter', () => {
      const letter = generateFOIALetter(mockRequest);

      // Should contain a date string (month name, day, year)
      expect(letter).toMatch(/\w+ \d{1,2}, \d{4}/);
    });

    it('omits award date clause when awardDate is missing', () => {
      const noAwardDateRequest: DBFOIARequestItem = {
        ...mockRequest,
        awardDate: undefined,
      };

      const letter = generateFOIALetter(noAwardDateRequest);

      expect(letter).not.toContain('awarded on or around');
    });

    it('omits awardee clause when awardeeName is missing', () => {
      const noAwardeeRequest: DBFOIARequestItem = {
        ...mockRequest,
        awardeeName: undefined,
      };

      const letter = generateFOIALetter(noAwardeeRequest);

      expect(letter).not.toContain('The contract was awarded to');
    });
  });
});
