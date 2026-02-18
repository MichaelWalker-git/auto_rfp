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
    });

    it('includes requester information', () => {
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

    it('lists requested documents with descriptions', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('The complete Source Selection Evaluation Board (SSEB) report, including all technical and cost/price evaluations');
      expect(letter).toContain('Technical evaluation reports and findings');
      expect(letter).toContain('Price/cost analysis documentation for all offerors');
    });

    it('includes FOIA statutory reference', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('Freedom of Information Act');
      expect(letter).toContain('5 U.S.C. § 552');
    });

    it('includes 20 working days response requirement', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('20 working days');
    });

    it('includes exemption disclosure request', () => {
      const letter = generateFOIALetter(mockRequest);

      expect(letter).toContain('exempt from disclosure');
      expect(letter).toContain('specific exemption');
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
        feeLimit: 100,
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

      expect(letter).toContain('The complete Source Selection Evaluation Board (SSEB) report, including all technical and cost/price evaluations');
      expect(letter).toContain('The Source Selection Decision Document (SSDD)');
      expect(letter).toContain('Technical evaluation reports and findings');
      expect(letter).toContain('Price/cost analysis documentation for all offerors');
      expect(letter).toContain('Past performance evaluation reports for all offerors');
      expect(letter).toContain('Debriefing Notes or Documentation');
    });
  });
});
