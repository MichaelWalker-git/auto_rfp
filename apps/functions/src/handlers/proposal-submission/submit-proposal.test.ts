// Mock middy before importing handlers
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
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-submission-uuid'),
}));

// Mock helpers
const mockCheckSubmissionReadiness = jest.fn();
const mockCreateSubmissionRecord = jest.fn();
const mockListRFPDocumentsByProject = jest.fn();
const mockGetOpportunity = jest.fn();
const mockOnProjectOutcomeSet = jest.fn();
const mockGetOrgMembers = jest.fn();
const mockSendNotification = jest.fn();
const mockBuildNotification = jest.fn();
const mockWriteAuditLog = jest.fn();
const mockGetHmacSecret = jest.fn();

jest.mock('@/helpers/proposal-submission', () => ({
  checkSubmissionReadiness: (...args: unknown[]) => mockCheckSubmissionReadiness(...args),
  createSubmissionRecord: (...args: unknown[]) => mockCreateSubmissionRecord(...args),
}));

jest.mock('@/helpers/rfp-document', () => ({
  listRFPDocumentsByProject: (...args: unknown[]) => mockListRFPDocumentsByProject(...args),
}));

jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

jest.mock('@/helpers/opportunity-stage', () => ({
  onProjectOutcomeSet: (...args: unknown[]) => mockOnProjectOutcomeSet(...args),
}));

jest.mock('@/helpers/user', () => ({
  getOrgMembers: (...args: unknown[]) => mockGetOrgMembers(...args),
}));

jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  buildNotification: (...args: unknown[]) => mockBuildNotification(...args),
}));

jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: () => mockGetHmacSecret(),
}));

jest.mock('@/helpers/resolve-users', () => ({
  resolveUserNames: jest.fn().mockResolvedValue({ 'user-123': 'john.doe' }),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
  GetObjectCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';

import { handler } from './submit-proposal';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: Record<string, unknown> = {}, orgId = 'org-1'): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: { orgId },
    headers: { 'user-agent': 'test-agent' },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: {
      userId: 'user-123',
      claims: { 'cognito:username': 'john.doe' },
    },
  } as unknown as AuthedEvent);

const validBody = {
  projectId: 'proj-1',
  oppId: 'opp-1',
  submissionMethod: 'PORTAL',
};

const mockOpp = {
  item: {
    title: 'Test Opportunity',
    responseDeadlineIso: '2025-12-31T00:00:00Z',
    stage: 'PURSUING',
  },
};

const mockReadiness = {
  ready: true,
  checks: [],
  blockingFails: 0,
  warningFails: 0,
};

const mockSubmission = {
  submissionId: 'mock-submission-uuid',
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  status: 'SUBMITTED',
  submissionMethod: 'PORTAL',
  submittedAt: '2025-01-01T00:00:00Z',
  submittedBy: 'user-123',
  documentIds: ['doc-1'],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('submit-proposal handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetOpportunity.mockResolvedValue(mockOpp);
    mockCheckSubmissionReadiness.mockResolvedValue(mockReadiness);
    mockListRFPDocumentsByProject.mockResolvedValue({
      items: [{ documentId: 'doc-1', status: 'READY', deletedAt: undefined }],
    });
    mockCreateSubmissionRecord.mockResolvedValue(mockSubmission);
    mockOnProjectOutcomeSet.mockResolvedValue(undefined);
    mockGetOrgMembers.mockResolvedValue([]);
    mockWriteAuditLog.mockResolvedValue(undefined);
    mockGetHmacSecret.mockResolvedValue('hmac-secret');
  });

  // ─── Validation ────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const event = {
        ...makeEvent(validBody),
        queryStringParameters: {},
      } as unknown as AuthedEvent;

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(event);
      expect((result as { statusCode: number }).statusCode).toBe(400);
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('orgId');
    });

    it('returns 400 when submissionMethod is missing', async () => {
      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent({ projectId: 'proj-1', oppId: 'opp-1' }),
      );
      expect((result as { statusCode: number }).statusCode).toBe(400);
    });

    it('returns 400 when projectId is missing', async () => {
      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent({ oppId: 'opp-1', submissionMethod: 'PORTAL' }),
      );
      expect((result as { statusCode: number }).statusCode).toBe(400);
    });
  });

  // ─── Not Found ─────────────────────────────────────────────────────────────

  describe('not found', () => {
    it('returns 404 when opportunity does not exist', async () => {
      mockGetOpportunity.mockResolvedValue(null);

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );
      expect((result as { statusCode: number }).statusCode).toBe(404);
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('not found');
    });
  });

  // ─── Readiness Guard ───────────────────────────────────────────────────────

  describe('readiness guard', () => {
    it('returns 422 when proposal is not ready and forceSubmit is false', async () => {
      mockCheckSubmissionReadiness.mockResolvedValue({
        ready: false,
        checks: [{ id: 'opportunity_stage', label: 'Stage', passed: false, blocking: true }],
        blockingFails: 1,
        warningFails: 0,
      });

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );
      expect((result as { statusCode: number }).statusCode).toBe(422);
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('not ready');
      expect(body.blockingFails).toBe(1);
    });

    it('proceeds when forceSubmit=true even if not ready', async () => {
      mockCheckSubmissionReadiness.mockResolvedValue({
        ready: false,
        checks: [],
        blockingFails: 1,
        warningFails: 0,
      });

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent({ ...validBody, forceSubmit: true }),
      );
      expect((result as { statusCode: number }).statusCode).toBe(200);
    });
  });

  // ─── Happy Path ────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('returns 200 with submission on success', async () => {
      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );
      expect((result as { statusCode: number }).statusCode).toBe(200);
      const body = JSON.parse((result as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.submission.submissionId).toBe('mock-submission-uuid');
    });

    it('calls createSubmissionRecord with correct args', async () => {
      await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );

      expect(mockCreateSubmissionRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-1',
          submissionMethod: 'PORTAL',
        }),
        'user-123',
        'john.doe',
        expect.any(Array),
        '2025-12-31T00:00:00Z',
      );
    });

    it('collects document IDs from listRFPDocumentsByProject when none provided', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [
          { documentId: 'doc-1', status: 'READY', deletedAt: undefined },
          { documentId: 'doc-2', status: 'READY', deletedAt: undefined },
          { documentId: 'doc-3', status: 'GENERATING', deletedAt: undefined }, // excluded
          { documentId: 'doc-4', status: 'READY', deletedAt: '2025-01-01T00:00:00Z' }, // excluded (deleted)
        ],
      });

      await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );

      expect(mockCreateSubmissionRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        ['doc-1', 'doc-2'], // only non-deleted, non-generating docs
        expect.anything(),
      );
    });

    it('uses provided documentIds when specified', async () => {
      await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent({ ...validBody, documentIds: ['specific-doc-1'] }),
      );

      expect(mockCreateSubmissionRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        ['specific-doc-1'],
        expect.anything(),
      );
      // listRFPDocumentsByProject is still called for email draft attachment URLs
      // but the submission record should use the provided documentIds, not the list result
    });

    it('triggers onProjectOutcomeSet with PENDING status (non-blocking)', async () => {
      await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );

      expect(mockOnProjectOutcomeSet).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-1',
          outcomeStatus: 'PENDING',
          changedBy: 'user-123',
        }),
      );
    });

    it('writes audit log with PROPOSAL_SUBMITTED action', async () => {
      await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PROPOSAL_SUBMITTED',
          resource: 'proposal',
          resourceId: 'mock-submission-uuid',
          organizationId: 'org-1',
          result: 'success',
        }),
        'hmac-secret',
      );
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('continues even when stage transition fails (non-blocking)', async () => {
      mockOnProjectOutcomeSet.mockRejectedValue(new Error('Stage transition failed'));

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );

      // Should still return 200 — stage transition is non-blocking
      expect((result as { statusCode: number }).statusCode).toBe(200);
    });

    it('continues even when notification fails (non-blocking)', async () => {
      mockGetOrgMembers.mockRejectedValue(new Error('Notification failed'));

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(
        makeEvent(validBody),
      );

      expect((result as { statusCode: number }).statusCode).toBe(200);
    });

    it('handles empty body gracefully', async () => {
      const event = {
        ...makeEvent(),
        body: null,
      } as unknown as AuthedEvent;

      const result = await (handler as unknown as { handler: (e: AuthedEvent) => Promise<unknown> }).handler(event);
      // Missing required fields → 400
      expect((result as { statusCode: number }).statusCode).toBe(400);
    });
  });
});
