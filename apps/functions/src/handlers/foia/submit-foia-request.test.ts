// Mock middy before importing handlers (ESM compatibility)
import { DBFOIARequestItem } from '../../types/project-outcome';

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

// Mock AWS SDK - DynamoDB
const mockDynamoSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockDynamoSend,
    })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

// Mock AWS SDK - SES
const mockSesSend = jest.fn();
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn(() => ({
    send: mockSesSend,
  })),
  SendEmailCommand: jest.fn((params) => ({ type: 'SendEmail', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { baseHandler } from './submit-foia-request';

// Helper: cast result to structured format (APIGatewayProxyResultV2 can be string | structured)
type StructuredResult = { statusCode: number; body: string; headers?: Record<string, string> };
const callHandler = async (event: Record<string, unknown>): Promise<StructuredResult> => {
  const result = await baseHandler(event as never);
  return result as StructuredResult;
};

describe('submit-foia-request handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoSend.mockReset();
    mockSesSend.mockReset();
  });

  const mockFoiaRequest: DBFOIARequestItem = {
    partition_key: 'FOIA_REQUEST',
    sort_key: 'org-456#proj-123#foia-1',
    foiaId: 'foia-1',
    id: 'foia-1',
    projectId: 'proj-123',
    orgId: 'org-456',
    status: 'DRAFT',
    agencyId: 'DOD',
    agencyName: 'Department of Defense',
    agencyAbbreviation: 'DoD',
    agencyFOIAEmail: 'foia@dod.gov',
    agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
    solicitationNumber: 'W911NF-21-R-0001',
    contractTitle: 'IT Services',
    requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL'],
    requesterCategory: 'OTHER',
    feeLimit: 100,
    requestFeeWaiver: false,
    requesterName: 'John Smith',
    requesterEmail: 'john@company.com',
    requesterPhone: '555-123-4567',
    requestedBy: 'user-789',
    statusHistory: [{ status: 'DRAFT', changedAt: '2025-01-15T00:00:00Z', changedBy: 'user-789' }],
    autoSubmitAttempted: false,
    generatedLetterS3Key: 's3-key',
    generatedLetterVersion: 1,
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
    createdBy: 'user-789',
  };

  const createEvent = (body: Record<string, unknown>) => ({
    body: JSON.stringify(body),
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user-789' } } },
    } as unknown,
    auth: { userId: 'user-789', claims: { sub: 'user-789' } },
    rbac: { role: 'ADMIN', permissions: ['project:edit'] },
    queryStringParameters: {},
    pathParameters: {},
  });

  describe('validation', () => {
    it('returns 400 when body is missing', async () => {
      const event = { ...createEvent({}), body: undefined };
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(body.message).toBe('Request body is missing');
    });

    it('returns 400 for invalid payload', async () => {
      const event = createEvent({ orgId: '', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'AUTO_EMAIL' });
      const result = await callHandler(event);

      expect(result.statusCode).toBe(400);
    });

    it('returns 400 for invalid method', async () => {
      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'INVALID' });
      const result = await callHandler(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe('FOIA request guards', () => {
    it('returns 404 when FOIA request not found', async () => {
      mockDynamoSend.mockResolvedValue({ Item: undefined });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'MANUAL' });
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(404);
      expect(body.message).toBe('FOIA request not found');
    });

    it('returns 400 when FOIA request is already SUBMITTED', async () => {
      mockDynamoSend.mockResolvedValue({ Item: { ...mockFoiaRequest, status: 'SUBMITTED' } });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'MANUAL' });
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(body.message).toContain('Cannot submit');
    });

    it('returns 400 when FOIA request is CLOSED', async () => {
      mockDynamoSend.mockResolvedValue({ Item: { ...mockFoiaRequest, status: 'CLOSED' } });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'MANUAL' });
      const result = await callHandler(event);

      expect(result.statusCode).toBe(400);
    });

    it('returns 400 for AUTO_EMAIL when no agency email', async () => {
      mockDynamoSend.mockResolvedValue({ Item: { ...mockFoiaRequest, agencyFOIAEmail: undefined } });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'AUTO_EMAIL' });
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(body.message).toContain('no agency FOIA email');
    });
  });

  describe('MANUAL submission', () => {
    it('marks request as SUBMITTED with MANUAL method', async () => {
      const updatedItem = { ...mockFoiaRequest, status: 'SUBMITTED', submissionMethod: 'MANUAL_EMAIL' };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: mockFoiaRequest }) // GetCommand
        .mockResolvedValueOnce({ Attributes: updatedItem }); // UpdateCommand

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'MANUAL' });
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(body.foiaRequest.status).toBe('SUBMITTED');
      expect(body.autoSubmitted).toBe(false);
    });

    it('does not call SES for MANUAL method', async () => {
      const updatedItem = { ...mockFoiaRequest, status: 'SUBMITTED' };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: mockFoiaRequest })
        .mockResolvedValueOnce({ Attributes: updatedItem });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'MANUAL' });
      await callHandler(event);

      expect(mockSesSend).not.toHaveBeenCalled();
    });
  });

  describe('AUTO_EMAIL submission', () => {
    it('sends email via SES and marks as SUBMITTED', async () => {
      mockSesSend.mockResolvedValue({ MessageId: 'msg-123' });
      const updatedItem = { ...mockFoiaRequest, status: 'SUBMITTED', autoSubmitSuccess: true };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: mockFoiaRequest })
        .mockResolvedValueOnce({ Attributes: updatedItem });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'AUTO_EMAIL' });
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(body.autoSubmitted).toBe(true);
      expect(mockSesSend).toHaveBeenCalledTimes(1);
    });

    it('handles SES failure gracefully', async () => {
      mockSesSend.mockRejectedValue(new Error('SES quota exceeded'));
      const updatedItem = { ...mockFoiaRequest, status: 'SUBMITTED', autoSubmitSuccess: false, autoSubmitError: 'SES quota exceeded' };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: mockFoiaRequest })
        .mockResolvedValueOnce({ Attributes: updatedItem });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'AUTO_EMAIL' });
      const result = await callHandler(event);
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(body.autoSubmitted).toBe(false);
      expect(body.error).toBe('SES quota exceeded');
    });

    it('allows submission from READY_TO_SUBMIT status', async () => {
      const readyRequest = { ...mockFoiaRequest, status: 'READY_TO_SUBMIT' };
      mockSesSend.mockResolvedValue({ MessageId: 'msg-123' });
      const updatedItem = { ...readyRequest, status: 'SUBMITTED' };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: readyRequest })
        .mockResolvedValueOnce({ Attributes: updatedItem });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'AUTO_EMAIL' });
      const result = await callHandler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('statusHistory', () => {
    it('appends SUBMITTED entry to statusHistory', async () => {
      const updatedItem = { ...mockFoiaRequest, status: 'SUBMITTED' };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: mockFoiaRequest })
        .mockResolvedValueOnce({ Attributes: updatedItem });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'MANUAL' });
      await callHandler(event);

      // The second call should be the UpdateCommand
      const updateCall = mockDynamoSend.mock.calls[1]?.[0];
      expect(updateCall?.params?.UpdateExpression).toContain('list_append(statusHistory, :newHistoryEntry)');
      expect(updateCall?.params?.ExpressionAttributeValues?.[':newHistoryEntry']).toEqual([
        expect.objectContaining({
          status: 'SUBMITTED',
          changedBy: 'user-789',
          changedAt: expect.any(String),
          notes: 'Manually submitted',
        }),
      ]);
    });

    it('includes auto-submit success note in statusHistory', async () => {
      mockSesSend.mockResolvedValue({ MessageId: 'msg-123' });
      const updatedItem = { ...mockFoiaRequest, status: 'SUBMITTED' };
      mockDynamoSend
        .mockResolvedValueOnce({ Item: mockFoiaRequest })
        .mockResolvedValueOnce({ Attributes: updatedItem });

      const event = createEvent({ orgId: 'org-456', projectId: 'proj-123', foiaRequestId: 'foia-1', method: 'AUTO_EMAIL' });
      await callHandler(event);

      const updateCall = mockDynamoSend.mock.calls[1]?.[0];
      const historyEntry = updateCall?.params?.ExpressionAttributeValues?.[':newHistoryEntry']?.[0];
      expect(historyEntry?.notes).toContain('Auto-submitted via email to foia@dod.gov');
    });
  });
});
