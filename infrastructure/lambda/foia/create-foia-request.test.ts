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

import { createFOIARequest } from './create-foia-request';
import type { CreateFOIARequest } from '@auto-rfp/shared';

describe('create-foia-request handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('createFOIARequest', () => {
    it('creates FOIA request with correct structure', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        agencyName: 'Department of Defense',
        agencyFOIAEmail: 'foia@dod.gov',
        solicitationNumber: 'W911NF-21-R-0001',
        requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL'],
        requesterName: 'John Doe',
        requesterEmail: 'john@company.com',
      };

      const result = await createFOIARequest(dto, 'user-789');

      expect(result.partition_key).toBe('FOIA_REQUEST');
      expect(result.sort_key).toBe('org-456#proj-123#mock-uuid');
      expect(result.status).toBe('DRAFT');
      expect(result.agencyName).toBe('Department of Defense');
      expect(result.requestedDocuments).toEqual(['SSEB_REPORT', 'TECHNICAL_EVAL']);
    });

    it('calculates expected response date (20 business days)', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        agencyName: 'GSA',
        solicitationNumber: 'GS-00F-0001',
        requestedDocuments: ['SSDD'],
        requesterName: 'Jane Smith',
        requesterEmail: 'jane@company.com',
      };

      const result = await createFOIARequest(dto, 'user-789');

      expect(result.expectedResponseDate).toBeDefined();
      // Should be about 4 weeks from now (20 business days)
      const expectedDate = new Date(result.expectedResponseDate);
      const now = new Date();
      const diffDays = Math.floor((expectedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(20);
      expect(diffDays).toBeLessThanOrEqual(30);
    });

    it('includes all optional fields', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        agencyName: 'Department of Veterans Affairs',
        agencyFOIAEmail: 'foia@va.gov',
        agencyFOIAAddress: '810 Vermont Ave NW, Washington DC',
        solicitationNumber: 'VA-123-21-R-0001',
        contractNumber: 'VA-123-C-0001',
        requestedDocuments: ['SSEB_REPORT', 'PRICE_ANALYSIS', 'PAST_PERFORMANCE_EVAL'],
        requesterName: 'Bob Johnson',
        requesterEmail: 'bob@company.com',
        requesterPhone: '555-123-4567',
        requesterAddress: '123 Main St, City, ST 12345',
        notes: 'Priority request',
      };

      const result = await createFOIARequest(dto, 'user-789');

      expect(result.agencyFOIAAddress).toBe('810 Vermont Ave NW, Washington DC');
      expect(result.contractNumber).toBe('VA-123-C-0001');
      expect(result.requesterPhone).toBe('555-123-4567');
      expect(result.requesterAddress).toBe('123 Main St, City, ST 12345');
      expect(result.notes).toBe('Priority request');
    });

    it('sets requestedBy to current user', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        agencyName: 'Test Agency',
        solicitationNumber: 'TEST-001',
        requestedDocuments: ['SSDD'],
        requesterName: 'Test User',
        requesterEmail: 'test@example.com',
      };

      const result = await createFOIARequest(dto, 'user-abc-123');

      expect(result.requestedBy).toBe('user-abc-123');
    });

    it('calls DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        agencyName: 'Test Agency',
        solicitationNumber: 'TEST-001',
        requestedDocuments: ['SSDD'],
        requesterName: 'Test User',
        requesterEmail: 'test@example.com',
      };

      await createFOIARequest(dto, 'user-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
          }),
        })
      );
    });
  });
});
