// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid before importing handlers
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

// Mock audit middleware
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { createDebriefing, baseHandler } from './create-debriefing';
import type { CreateDebriefingRequest } from '@auto-rfp/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const validDto: CreateDebriefingRequest = {
  projectId: 'proj-123',
  orgId: 'org-456',
  opportunityId: 'opp-789',
  solicitationNumber: 'W911NF-21-R-0001',
  contractTitle: 'IT Services Contract',
  awardedOrganization: 'WinnerCo LLC',
  awardNotificationDate: 'January 15, 2025',
  contractingOfficerName: 'Jane Officer',
  contractingOfficerEmail: 'jane@agency.gov',
  requesterName: 'John Smith',
  requesterTitle: 'Contracts Manager',
  requesterEmail: 'john@company.com',
  requesterPhone: '555-123-4567',
  requesterAddress: '123 Business Ave, Arlington VA 22201',
  companyName: 'Acme Corp',
};

describe('create-debriefing handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('createDebriefing', () => {
    it('creates debriefing with correct structure', async () => {
      mockSend.mockResolvedValue({});

      const result = await createDebriefing(validDto, 'user-789');

      expect(result.partition_key).toBe('DEBRIEFING');
      expect(result.sort_key).toBe('org-456#proj-123#opp-789#mock-uuid');
      expect(result.debriefId).toBe('mock-uuid');
      expect(result.createdBy).toBe('user-789');
    });

    it('stores opportunityId on the item', async () => {
      mockSend.mockResolvedValue({});

      const result = await createDebriefing(validDto, 'user-789');

      expect(result.opportunityId).toBe('opp-789');
    });

    it('does not include status or deadline fields', async () => {
      mockSend.mockResolvedValue({});

      const result = await createDebriefing(validDto, 'user-789');

      expect(result).not.toHaveProperty('requestStatus');
      expect(result).not.toHaveProperty('requestDeadline');
    });

    it('stores all new fields in the DynamoDB item', async () => {
      mockSend.mockResolvedValue({});

      const result = await createDebriefing(validDto, 'user-789');

      expect(result.solicitationNumber).toBe('W911NF-21-R-0001');
      expect(result.contractTitle).toBe('IT Services Contract');
      expect(result.awardedOrganization).toBe('WinnerCo LLC');
      expect(result.awardNotificationDate).toBe('January 15, 2025');
      expect(result.contractingOfficerName).toBe('Jane Officer');
      expect(result.contractingOfficerEmail).toBe('jane@agency.gov');
      expect(result.requesterName).toBe('John Smith');
      expect(result.requesterTitle).toBe('Contracts Manager');
      expect(result.requesterEmail).toBe('john@company.com');
      expect(result.requesterPhone).toBe('555-123-4567');
      expect(result.requesterAddress).toBe('123 Business Ave, Arlington VA 22201');
      expect(result.companyName).toBe('Acme Corp');
    });

    it('sets timestamps correctly', async () => {
      mockSend.mockResolvedValue({});
      const beforeCall = new Date().toISOString();

      const result = await createDebriefing(validDto, 'user-789');

      const afterCall = new Date().toISOString();

      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.createdAt >= beforeCall).toBe(true);
      expect(result.createdAt <= afterCall).toBe(true);
    });

    it('calls DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValue({});

      await createDebriefing(validDto, 'user-789');

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
    const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 & { authContext?: { userId?: string } } =>
      ({
        body: JSON.stringify(body),
        authContext: { userId: 'user-789' },
      }) as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };

    it('returns 400 when no outcome item exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(makeEvent(validDto));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('LOST');
    });

    it('returns 400 when outcome exists but is not LOST', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { status: 'WON' },
      });

      const result = await baseHandler(makeEvent(validDto));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('LOST');
    });

    it('allows creation (201) when outcome has status LOST', async () => {
      // First call: GetCommand for checkLostOutcome
      mockSend.mockResolvedValueOnce({
        Item: { status: 'LOST' },
      });
      // Second call: PutCommand for createDebriefing
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(makeEvent(validDto));

      expect(result.statusCode).toBe(201);
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

    it('uses GetCommand with correct PK and full 3-part SK', async () => {
      mockSend.mockResolvedValueOnce({ Item: { status: 'LOST' } });
      mockSend.mockResolvedValueOnce({});

      await baseHandler(makeEvent(validDto));

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.type).toBe('Get');
      expect(getCall.params.Key.partition_key).toBe('PROJECT_OUTCOME');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789');
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

    it('defaults userId to unknown when authContext is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: { status: 'LOST' } });
      mockSend.mockResolvedValueOnce({});

      const event = {
        body: JSON.stringify(validDto),
      } as unknown as APIGatewayProxyEventV2 & { authContext?: { userId?: string } };

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body as string);
      expect(parsed.debriefing.createdBy).toBe('unknown');
    });
  });
});
