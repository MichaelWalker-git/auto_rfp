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
      requesterCategory: 'OTHER',
      feeLimit: 100,
      requestFeeWaiver: false,
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

      expect(letter).toContain('Department of Defense');
      expect(letter).toContain('1400 Defense Pentagon, Washington DC 20301');
      expect(letter).toContain('foia@dod.gov');
    });

    it('includes requester information in contact section', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('John Smith');
      expect(letter).toContain('john.smith@company.com');
      expect(letter).toContain('555-123-4567');
      expect(letter).toContain('123 Business Ave, Suite 100, Arlington VA 22201');
    });

    it('includes solicitation and contract numbers', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('W911NF-21-R-0001');
      expect(letter).toContain('W911NF-21-C-0001');
    });

    it('lists requested documents with numbered descriptions', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('1. The complete Source Selection Evaluation Board (SSEB) report');
      expect(letter).toContain('2. Technical evaluation reports and findings');
      expect(letter).toContain('3. Price/cost analysis documentation for all offerors');
    });

    it('includes proper FOIA statutory citations', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('5 U.S.C. § 552');
      expect(letter).toContain('5 U.S.C. § 552(a)(3)(A)');
      expect(letter).toContain('5 U.S.C. § 552(a)(6)(A)(i)');
    });

    it('includes segregability clause with Vaughn index request', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('SEGREGABILITY');
      expect(letter).toContain('reasonably segregable');
      expect(letter).toContain('Vaughn index');
      expect(letter).toContain('5 U.S.C. § 552(b)(1)-(9)');
    });

    it('includes appeal rights section with OGIS reference', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('APPEAL RIGHTS');
      expect(letter).toContain('90 days');
      expect(letter).toContain('5 U.S.C. § 552(a)(4)(B)');
      expect(letter).toContain('Office of Government Information Services (OGIS)');
    });

    it('includes electronic format request per E-FOIA', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('FORMAT OF RECORDS');
      expect(letter).toContain('Electronic Freedom of Information Act Amendments of 1996');
      expect(letter).toContain('electronic format (PDF preferred)');
    });

    it('includes 20 business day response deadline', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('twenty (20) business days');
      expect(letter).toContain('RESPONSE DEADLINE');
    });

    it('includes fee category for "OTHER" requester', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('FEES');
      expect(letter).toContain('"all other" requester');
      expect(letter).toContain('two hours of search time');
      expect(letter).toContain('100 pages of duplication at no charge');
      expect(letter).toContain('$100.00');
    });

    it('includes fee category for COMMERCIAL requester', () => {
      const commercialRequest: DBFOIARequestItem = {
        ...mockRequest,
        requesterCategory: 'COMMERCIAL',
      };

      const letter = generateFOIALetter(commercialRequest);

      expect(letter).toContain('commercial use requester');
      expect(letter).toContain('search, review, and duplication fees');
    });

    it('includes fee category for EDUCATIONAL requester', () => {
      const eduRequest: DBFOIARequestItem = {
        ...mockRequest,
        requesterCategory: 'EDUCATIONAL',
      };

      const letter = generateFOIALetter(eduRequest);

      expect(letter).toContain('educational institution requester');
      expect(letter).toContain('scholarly purposes');
      expect(letter).toContain('should not be charged search fees');
    });

    it('includes fee category for NEWS_MEDIA requester', () => {
      const mediaRequest: DBFOIARequestItem = {
        ...mockRequest,
        requesterCategory: 'NEWS_MEDIA',
      };

      const letter = generateFOIALetter(mediaRequest);

      expect(letter).toContain('representative of the news media');
      expect(letter).toContain('news-gathering purposes');
    });

    it('includes fee waiver section when requested', () => {
      const feeWaiverRequest: DBFOIARequestItem = {
        ...mockRequest,
        requestFeeWaiver: true,
        feeWaiverJustification: 'Non-profit research for public benefit',
      };

      const letter = generateFOIALetter(feeWaiverRequest);

      expect(letter).toContain('FEE WAIVER REQUEST');
      expect(letter).toContain('5 U.S.C. § 552(a)(4)(A)(iii)');
      expect(letter).toContain('public interest');
      expect(letter).toContain('Non-profit research for public benefit');
      expect(letter).toContain('$100.00');
    });

    it('includes fee waiver without justification', () => {
      const feeWaiverRequest: DBFOIARequestItem = {
        ...mockRequest,
        requestFeeWaiver: true,
      };

      const letter = generateFOIALetter(feeWaiverRequest);

      expect(letter).toContain('FEE WAIVER REQUEST');
      expect(letter).not.toContain('Specifically:');
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

    it('indicates VIA EMAIL when agency email is present', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('VIA EMAIL');
    });

    it('indicates VIA MAIL when no agency email', () => {
      const mailRequest: DBFOIARequestItem = {
        ...mockRequest,
        agencyFOIAEmail: undefined,
      };

      const letter = generateFOIALetter(mailRequest);

      expect(letter).toContain('VIA MAIL');
    });

    it('includes description of requester as unsuccessful offeror', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('DESCRIPTION OF REQUESTER AND PURPOSE');
      expect(letter).toContain('unsuccessful offeror');
      expect(letter).toContain('evaluation criteria');
      expect(letter).toContain('scoring methodology');
    });

    it('works without optional fields', () => {
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
        requesterCategory: 'OTHER',
        feeLimit: 50,
        requestFeeWaiver: false,
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
      expect(letter).toContain('[Agency FOIA Office Address]');
      expect(letter).toContain('[Address]');
      expect(letter).toContain('$50.00');
    });

    it('includes all document types when requested', () => {
      const fullRequest: DBFOIARequestItem = {
        ...mockRequest,
        requestedDocuments: [
          'SSEB_REPORT',
          'SSDD',
          'TECHNICAL_EVAL',
          'PRICE_ANALYSIS',
          'PAST_PERFORMANCE_EVAL',
          'DEBRIEFING_NOTES',
        ],
      };

      const letter = generateFOIALetter(fullRequest);

      expect(letter).toContain('1. The complete Source Selection Evaluation Board (SSEB) report');
      expect(letter).toContain('2. The Source Selection Decision Document (SSDD)');
      expect(letter).toContain('3. Technical evaluation reports and findings');
      expect(letter).toContain('4. Price/cost analysis documentation for all offerors');
      expect(letter).toContain('5. Past performance evaluation reports for all offerors');
      expect(letter).toContain('6. Debriefing Notes or Documentation');
    });

    it('includes date in the letter', () => {
      const letter = generateFOIALetter(mockRequest);

      // Should contain a date string (month name, day, year)
      expect(letter).toMatch(/\w+ \d{1,2}, \d{4}/);
      expect(letter).toContain('Date:');
    });

    it('ends with respectfully submitted closing', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('Respectfully submitted,');
    });
  });
});
