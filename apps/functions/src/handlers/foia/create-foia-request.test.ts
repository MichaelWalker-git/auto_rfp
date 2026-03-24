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

import { createFOIARequest, baseHandler } from './create-foia-request';
import type { CreateFOIARequest } from '@auto-rfp/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

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
        opportunityId: 'opp-789',
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
      expect(result.foiaId).toBe('mock-uuid');
      expect(result.status).toBe('DRAFT');
      expect(result.agencyName).toBe('Department of Defense');
      expect(result.requestedDocuments).toEqual(['SSEB_REPORT', 'TECHNICAL_EVAL']);
    });

    it('calculates response deadline (20 business days)', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        agencyName: 'GSA',
        solicitationNumber: 'GS-00F-0001',
        requestedDocuments: ['SSDD'],
        requesterName: 'Jane Smith',
        requesterEmail: 'jane@company.com',
      };

      const result = await createFOIARequest(dto, 'user-789');

      expect(result.responseDeadline).toBeDefined();
      // Should be about 4 weeks from now (20 business days)
      if (result.responseDeadline) {
        const responseDeadline = new Date(result.responseDeadline);
        const now = new Date();
        const diffDays = Math.floor((responseDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        expect(diffDays).toBeGreaterThanOrEqual(20);
        expect(diffDays).toBeLessThanOrEqual(30);
      }
    });

    it('includes all optional fields', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        agencyName: 'Department of Veterans Affairs',
        agencyFOIAEmail: 'foia@va.gov',
        agencyFOIAAddress: '810 Vermont Ave NW, Washington DC',
        solicitationNumber: 'VA-123-21-R-0001',
        contractNumber: 'VA-123-C-0001',
        contractTitle: 'VA IT Modernization',
        requestedDocuments: ['SSEB_REPORT', 'PRICE_ANALYSIS', 'PAST_PERFORMANCE_EVAL'],
        requesterName: 'Bob Johnson',
        requesterEmail: 'bob@company.com',
        requesterPhone: '555-123-4567',
        requesterAddress: '123 Main St, City, ST 12345',
        companyName: 'Johnson Corp',
        samUEI: 'XYZ789ABC123',
        awardeeName: 'WinnerCo LLC',
        awardDate: 'March 1, 2026',
        feeLimit: 100,
        notes: 'Priority request',
      };

      const result = await createFOIARequest(dto, 'user-789');

      expect(result.agencyFOIAAddress).toBe('810 Vermont Ave NW, Washington DC');
      expect(result.contractNumber).toBe('VA-123-C-0001');
      expect(result.contractTitle).toBe('VA IT Modernization');
      expect(result.requesterPhone).toBe('555-123-4567');
      expect(result.requesterAddress).toBe('123 Main St, City, ST 12345');
      expect(result.companyName).toBe('Johnson Corp');
      expect(result.samUEI).toBe('XYZ789ABC123');
      expect(result.awardeeName).toBe('WinnerCo LLC');
      expect(result.awardDate).toBe('March 1, 2026');
      expect(result.notes).toBe('Priority request');
    });

    it('sets createdBy to current user', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        agencyName: 'Test Agency',
        solicitationNumber: 'TEST-001',
        requestedDocuments: ['SSDD'],
        requesterName: 'Test User',
        requesterEmail: 'test@example.com',
      };

      const result = await createFOIARequest(dto, 'user-abc-123');

      expect(result.createdBy).toBe('user-abc-123');
    });

    it('calls DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateFOIARequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
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

  describe('baseHandler — checkLostOutcome guard', () => {
    const validBody = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      agencyName: 'Test Agency',
      solicitationNumber: 'TEST-001',
      requestedDocuments: ['SSDD'],
      requesterName: 'Test User',
      requesterEmail: 'test@example.com',
    };

    const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 & { authContext?: { userId?: string } } =>
      ({
        body: JSON.stringify(body),
        authContext: { userId: 'user-789' },
      }) as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };

    it('returns 400 when no outcome item exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(makeEvent(validBody));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('LOST');
    });

    it('returns 400 when outcome exists but is not LOST', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { status: 'WON' },
      });

      const result = await baseHandler(makeEvent(validBody));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('LOST');
    });

    it('allows creation (201) when outcome has status LOST', async () => {
      // First call: GetCommand for checkLostOutcome
      mockSend.mockResolvedValueOnce({
        Item: { status: 'LOST' },
      });
      // Second call: PutCommand for createFOIARequest
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(makeEvent(validBody));

      expect(result.statusCode).toBe(201);
    });

    it('uses GetCommand with correct PK and full 3-part SK', async () => {
      mockSend.mockResolvedValueOnce({ Item: { status: 'LOST' } });
      mockSend.mockResolvedValueOnce({});

      await baseHandler(makeEvent(validBody));

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.type).toBe('Get');
      expect(getCall.params.Key.partition_key).toBe('PROJECT_OUTCOME');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789');
    });
  });
});
