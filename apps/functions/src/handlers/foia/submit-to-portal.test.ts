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
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// Mock other modules
jest.mock('@/helpers/api', () => ({
  apiResponse: jest.fn((statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(),
  httpErrorMiddleware: jest.fn(),
  orgMembershipMiddleware: jest.fn(),
  requirePermission: jest.fn(),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(),
  setAuditContext: jest.fn(),
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn().mockReturnValue('test-table'),
}));

jest.mock('@/helpers/db', () => ({
  docClient: { send: mockSend },
}));

jest.mock('@/helpers/foia-request', () => ({
  getFOIARequest: jest.fn(),
}));

jest.mock('@/helpers/portal-detection', () => ({
  detectAgencyPortal: jest.fn(),
}));

jest.mock('@/helpers/portal-submission', () => ({
  submitToPortal: jest.fn(),
  retryPortalSubmission: jest.fn(),
}));

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './submit-to-portal';
import type { FOIARequest } from '@auto-rfp/core';

const mockGetFOIARequest = require('@/helpers/foia-request').getFOIARequest as jest.MockedFunction<() => Promise<FOIARequest | null>>;
const mockDetectAgencyPortal = require('@/helpers/portal-detection').detectAgencyPortal as jest.MockedFunction<() => Promise<unknown>>;
const mockRetryPortalSubmission = require('@/helpers/portal-submission').retryPortalSubmission as jest.MockedFunction<() => Promise<unknown>>;

describe('submit-to-portal', () => {
  const mockEvent = (body: unknown) =>
    ({
      body: JSON.stringify(body),
      requestContext: {
        requestId: 'test-request-id',
      },
      auth: { userId: 'user-123', orgId: 'org-123' },
      rbac: { permissions: ['project:edit'], tenantId: 'org-123' },
    }) as unknown as APIGatewayProxyEventV2;

  const mockFOIARequest: FOIARequest = {
    foiaRequestId: 'foia-123',
    orgId: 'org-123',
    projectId: 'project-123',
    opportunityId: 'opp-123',
    agencyName: 'California Department of Fish and Wildlife',
    solicitationNumber: 'SOL-123',
    contractTitle: 'Test Contract',
    requestedDocuments: ['Document 1', 'Document 2'],
    requesterName: 'John Doe',
    requesterTitle: 'CEO',
    requesterEmail: 'john@example.com',
    requesterPhone: '555-1234',
    requesterAddress: '123 Main St',
    companyName: 'Test Company',
    awardeeName: 'Awardee Company',
    awardDate: '2026-01-15',
    feeLimit: 100,
    status: 'DRAFT',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    portalDetected: true,
    portalType: 'GovQA',
    portalBaseUrl: 'https://californiadfw.govqa.us',
    portalRecordTypeField: 'type_of_record_requested',
    portalRecordTypeValue: 'California Department of Fish and Wildlife',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('validation', () => {
    it('returns 400 if body is missing', async () => {
      const event = { ...mockEvent({}), body: undefined } as unknown as APIGatewayProxyEventV2;
      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'Request body is missing',
      });
    });

    it('returns 400 if orgId is missing', async () => {
      const event = mockEvent({
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || '{}');
      expect(body.message).toBe('Validation failed');
      expect(body.errors).toBeDefined();
    });

    it('returns 400 if foiaRequestId is missing', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || '{}');
      expect(body.message).toBe('Validation failed');
    });

    it('validates maxRetries is in range', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
        maxRetries: 10, // Max is 5
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body || '{}');
      expect(body.message).toBe('Validation failed');
    });
  });

  describe('request not found', () => {
    it('returns 404 if FOIA request does not exist', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue(null);

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'FOIA request not found',
      });
    });
  });

  describe('portal not detected', () => {
    it('returns 400 if no portal was detected for the request', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue({
        ...mockFOIARequest,
        portalDetected: false,
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'No portal detected for this agency - cannot submit via portal',
      });
    });
  });

  describe('already submitted', () => {
    it('returns 400 if request was already submitted successfully', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue({
        ...mockFOIARequest,
        submissionStatus: 'SUBMITTED',
        submissionConfirmationNumber: 'CONF-12345',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'FOIA request already submitted to portal',
        confirmationNumber: 'CONF-12345',
      });
    });
  });

  describe('successful submission', () => {
    it('submits to portal and returns confirmation number', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue(mockFOIARequest);
      mockDetectAgencyPortal.mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us',
        recordTypeField: 'type_of_record_requested',
        recordTypeValue: 'California Department of Fish and Wildlife',
      });
      mockRetryPortalSubmission.mockResolvedValue({
        success: true,
        confirmationNumber: 'CONF-98765',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'FOIA request submitted successfully',
        confirmationNumber: 'CONF-98765',
      });

      // Verify DynamoDB was updated
      expect(mockSend).toHaveBeenCalled();
    });

    it('passes custom captcha solver config to submission', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
        captchaSolver: {
          provider: '2captcha',
          apiKey: 'test-api-key',
        },
      });

      mockGetFOIARequest.mockResolvedValue(mockFOIARequest);
      mockDetectAgencyPortal.mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us',
      });
      mockRetryPortalSubmission.mockResolvedValue({
        success: true,
        confirmationNumber: 'CONF-98765',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(200);
      expect(mockRetryPortalSubmission).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          captchaSolver: {
            provider: '2captcha',
            apiKey: 'test-api-key',
          },
        })
      );
    });
  });

  describe('submission requires manual review', () => {
    it('returns 202 if portal submission requires manual intervention', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue(mockFOIARequest);
      mockDetectAgencyPortal.mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us',
      });
      mockRetryPortalSubmission.mockResolvedValue({
        success: false,
        requiresManualReview: true,
        error: 'CAPTCHA solving service unavailable',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'Portal submission requires manual review',
        error: 'CAPTCHA solving service unavailable',
      });

      // Verify status was updated to MANUAL_REVIEW
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('submission failed', () => {
    it('returns 500 if submission fails after retries', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue(mockFOIARequest);
      mockDetectAgencyPortal.mockResolvedValue({
        detected: true,
        type: 'GovQA',
        baseUrl: 'https://californiadfw.govqa.us',
      });
      mockRetryPortalSubmission.mockResolvedValue({
        success: false,
        requiresManualReview: false,
        error: 'Portal is temporarily unavailable',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'Portal submission failed',
        error: 'Portal is temporarily unavailable',
      });
    });
  });

  describe('portal detection fails on re-detection', () => {
    it('returns 400 if portal cannot be detected during submission', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockResolvedValue(mockFOIARequest);
      mockDetectAgencyPortal.mockResolvedValue({
        detected: false,
        type: 'Unknown',
        baseUrl: '',
      });

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'Portal detection failed - cannot submit',
      });
    });
  });

  describe('error handling', () => {
    it('handles invalid JSON in request body', async () => {
      const event = {
        ...mockEvent({}),
        body: 'invalid json{',
      } as unknown as APIGatewayProxyEventV2;

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'Invalid JSON in request body',
      });
    });

    it('handles unexpected errors gracefully', async () => {
      const event = mockEvent({
        orgId: 'org-123',
        projectId: 'project-123',
        opportunityId: 'opp-123',
        foiaRequestId: 'foia-123',
      });

      mockGetFOIARequest.mockRejectedValue(new Error('Database connection failed'));

      const result = await baseHandler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body || '{}')).toEqual({
        message: 'Internal server error',
        error: 'Database connection failed',
      });
    });
  });
});
