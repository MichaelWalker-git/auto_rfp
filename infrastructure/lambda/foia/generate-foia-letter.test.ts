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
import type { DBFOIARequestItem } from '../types/project-outcome';

describe('generate-foia-letter handler', () => {
  describe('generateFOIALetter', () => {
    const mockRequest: DBFOIARequestItem = {
      partition_key: 'FOIA_REQUEST',
      sort_key: 'org-456#proj-123#foia-1',
      id: 'foia-1',
      projectId: 'proj-123',
      orgId: 'org-456',
      status: 'DRAFT',
      agencyName: 'Department of Defense',
      agencyFOIAEmail: 'foia@dod.gov',
      agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
      solicitationNumber: 'W911NF-21-R-0001',
      contractNumber: 'W911NF-21-C-0001',
      requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL', 'PRICE_ANALYSIS'],
      requesterName: 'John Smith',
      requesterEmail: 'john.smith@company.com',
      requesterPhone: '555-123-4567',
      requesterAddress: '123 Business Ave, Suite 100, Arlington VA 22201',
      requestedBy: 'user-789',
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
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

      expect(letter).toContain('Source Selection Evaluation Board (SSEB) Report');
      expect(letter).toContain('Technical Evaluation Documentation');
      expect(letter).toContain('Price/Cost Analysis');
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
        status: 'DRAFT',
        agencyName: 'GSA',
        solicitationNumber: 'GS-00F-0001',
        requestedDocuments: ['SSDD'],
        requesterName: 'Jane Doe',
        requesterEmail: 'jane@example.com',
        requestedBy: 'user-789',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
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

      expect(letter).toContain('Source Selection Evaluation Board');
      expect(letter).toContain('Source Selection Decision Document');
      expect(letter).toContain('Technical Evaluation');
      expect(letter).toContain('Price/Cost Analysis');
      expect(letter).toContain('Past Performance Evaluation');
      expect(letter).toContain('Debriefing Notes');
    });
  });
});
