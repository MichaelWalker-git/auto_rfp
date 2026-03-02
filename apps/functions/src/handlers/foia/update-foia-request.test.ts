// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid (ESM module)
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
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { updateFOIARequest } from './update-foia-request';
import type { UpdateFOIARequest } from '@auto-rfp/core';
import type { DBFOIARequestItem } from '@/types/project-outcome';

describe('update-foia-request handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('updateFOIARequest', () => {
    const existingRequest: DBFOIARequestItem = {
      partition_key: 'FOIA_REQUEST',
      sort_key: 'org-456#proj-123#foia-1',
      id: 'foia-1',
      foiaId: 'foia-1',
      projectId: 'proj-123',
      orgId: 'org-456',
      status: 'DRAFT',
      agencyId: 'DOD',
      agencyName: 'DOD',
      agencyAbbreviation: 'DOD',
      solicitationNumber: 'W911NF-21-R-0001',
      contractTitle: 'IT Services',
      requestedDocuments: ['SSEB_REPORT'],
      requesterCategory: 'OTHER',
      feeLimit: 50,
      requestFeeWaiver: false,
      requesterName: 'John Doe',
      requesterEmail: 'john@example.com',
      requestedBy: 'user-789',
      statusHistory: [{ status: 'DRAFT', changedAt: '2025-01-15T00:00:00Z', changedBy: 'user-789' }],
      autoSubmitAttempted: false,
      generatedLetterS3Key: 's3-key',
      generatedLetterVersion: 1,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
      createdBy: 'user-789',
    };

    it('updates status to SUBMITTED', async () => {
      const updatedItem = {
        ...existingRequest,
        status: 'SUBMITTED',
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        status: 'SUBMITTED',
      };

      const result = await updateFOIARequest(dto, existingRequest, 'user-789');

      expect(result.status).toBe('SUBMITTED');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            UpdateExpression: expect.stringContaining('#status = :status'),
          }),
        }),
      );
    });

    it('appends to statusHistory when status changes', async () => {
      const updatedItem = {
        ...existingRequest,
        status: 'SUBMITTED',
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        status: 'SUBMITTED',
      };

      await updateFOIARequest(dto, existingRequest, 'user-abc');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            UpdateExpression: expect.stringContaining('list_append(statusHistory, :newHistoryEntry)'),
            ExpressionAttributeValues: expect.objectContaining({
              ':newHistoryEntry': [
                expect.objectContaining({
                  status: 'SUBMITTED',
                  changedBy: 'user-abc',
                  changedAt: expect.any(String),
                }),
              ],
            }),
          }),
        }),
      );
    });

    it('includes notes in statusHistory entry when provided with status change', async () => {
      const updatedItem = {
        ...existingRequest,
        status: 'SUBMITTED',
        notes: 'Submitted via email',
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        status: 'SUBMITTED',
        notes: 'Submitted via email',
      };

      await updateFOIARequest(dto, existingRequest, 'user-abc');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            ExpressionAttributeValues: expect.objectContaining({
              ':newHistoryEntry': [
                expect.objectContaining({
                  status: 'SUBMITTED',
                  changedBy: 'user-abc',
                  notes: 'Submitted via email',
                }),
              ],
            }),
          }),
        }),
      );
    });

    it('does not append to statusHistory when status is not changed', async () => {
      const updatedItem = {
        ...existingRequest,
        notes: 'Just a note update',
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        notes: 'Just a note update',
      };

      await updateFOIARequest(dto, existingRequest, 'user-abc');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            UpdateExpression: expect.not.stringContaining('statusHistory'),
          }),
        }),
      );
    });

    it('defaults userId to unknown when not provided', async () => {
      const updatedItem = {
        ...existingRequest,
        status: 'ACKNOWLEDGED',
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        status: 'ACKNOWLEDGED',
      };

      await updateFOIARequest(dto, existingRequest);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            ExpressionAttributeValues: expect.objectContaining({
              ':newHistoryEntry': [
                expect.objectContaining({
                  changedBy: 'unknown',
                }),
              ],
            }),
          }),
        }),
      );
    });

    it('updates tracking number', async () => {
      const updatedItem = {
        ...existingRequest,
        trackingNumber: 'FOIA-2025-001234',
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        trackingNumber: 'FOIA-2025-001234',
      };

      const result = await updateFOIARequest(dto, existingRequest, 'user-789');

      expect(result.trackingNumber).toBe('FOIA-2025-001234');
    });

    it('updates response information', async () => {
      const responseDate = '2025-02-15T00:00:00Z';
      const updatedItem = {
        ...existingRequest,
        status: 'RESPONSE_RECEIVED',
        responseDate,
        responseNotes: 'Partial documents received',
        receivedDocuments: ['SSEB_REPORT'],
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        status: 'RESPONSE_RECEIVED',
        responseDate,
        responseNotes: 'Partial documents received',
        receivedDocuments: ['SSEB_REPORT'],
      };

      const result = await updateFOIARequest(dto, existingRequest, 'user-789');

      expect(result.status).toBe('RESPONSE_RECEIVED');
      expect(result.responseDate).toBe(responseDate);
      expect(result.responseNotes).toBe('Partial documents received');
    });

    it('updates appeal information', async () => {
      const appealDeadline = '2025-03-01T00:00:00Z';
      const appealDate = '2025-02-28T00:00:00Z';
      const updatedItem = {
        ...existingRequest,
        status: 'APPEAL_FILED',
        appealDeadline,
        appealDate,
        updatedAt: expect.any(String),
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        status: 'APPEAL_FILED',
        appealDeadline,
        appealDate,
      };

      const result = await updateFOIARequest(dto, existingRequest, 'user-789');

      expect(result.status).toBe('APPEAL_FILED');
      expect(result.appealDeadline).toBe(appealDeadline);
      expect(result.appealDate).toBe(appealDate);
    });

    it('always updates updatedAt timestamp', async () => {
      const updatedItem = {
        ...existingRequest,
        notes: 'Test note',
        updatedAt: '2025-01-28T12:00:00.000Z',
      };
      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        notes: 'Test note',
      };

      await updateFOIARequest(dto, existingRequest, 'user-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            UpdateExpression: expect.stringContaining('updatedAt = :updatedAt'),
          }),
        }),
      );
    });

    it('uses correct table name and keys', async () => {
      mockSend.mockResolvedValue({ Attributes: existingRequest });

      const dto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        foiaRequestId: 'foia-1',
        notes: 'Test',
      };

      await updateFOIARequest(dto, existingRequest, 'user-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            Key: {
              partition_key: 'FOIA_REQUEST',
              sort_key: 'org-456#proj-123#foia-1',
            },
          }),
        }),
      );
    });
  });
});
