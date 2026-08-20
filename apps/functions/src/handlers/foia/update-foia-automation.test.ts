// Mock middy before imports
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock helpers
const mockTransitionFoiaAutomationState = jest.fn();
const mockSyncOpportunityFoiaMarker = jest.fn();
const mockGetFoiaAutomation = jest.fn();
const mockGetOpportunity = jest.fn();
const mockGetSubmissionHistory = jest.fn();

jest.mock('@/helpers/foia-automation', () => ({
  transitionFoiaAutomationState: (...args: unknown[]) => mockTransitionFoiaAutomationState(...args),
  syncOpportunityFoiaMarker: (...args: unknown[]) => mockSyncOpportunityFoiaMarker(...args),
  getFoiaAutomation: (...args: unknown[]) => mockGetFoiaAutomation(...args),
}));

jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

jest.mock('@/helpers/proposal-submission', () => ({
  getSubmissionHistory: (...args: unknown[]) => mockGetSubmissionHistory(...args),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './update-foia-automation';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn() })),
  setAuditContext: (...args: unknown[]) => mockSetAuditContext(...args),
}));

describe('update-foia-automation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransitionFoiaAutomationState.mockReset();
    mockSyncOpportunityFoiaMarker.mockReset();
    mockGetFoiaAutomation.mockReset();
    mockGetOpportunity.mockReset();
    mockGetSubmissionHistory.mockReset();
    mockSetAuditContext.mockClear();
    mockSyncOpportunityFoiaMarker.mockResolvedValue(undefined);
  });

  it('should return 400 when payload is invalid', async () => {
    const event: AuthedEvent = {
      body: JSON.stringify({ orgId: 'org-123' }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toBe('Invalid payload');
  });

  it('should cancel automation successfully', async () => {
    const automation = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SUPPRESSED',
    };
    mockTransitionFoiaAutomationState.mockResolvedValueOnce(automation);

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        cancel: true,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.automation.state).toBe('SUPPRESSED');
    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: ['SCHEDULED', 'BLOCKED', 'AWAITING_APPROVAL', 'STALLED', 'NOT_APPLICABLE'],
        to: 'SUPPRESSED',
      }),
    );
  });

  it('should return 409 when transition fails (concurrent update)', async () => {
    mockTransitionFoiaAutomationState.mockResolvedValueOnce(null);

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        cancel: true,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('concurrent');
  });

  it('should mark manual completed successfully', async () => {
    const automation = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'MANUAL_COMPLETED',
    };
    mockTransitionFoiaAutomationState.mockResolvedValueOnce(automation);

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        markManualCompleted: true,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.automation.state).toBe('MANUAL_COMPLETED');
  });

  it('should return 404 when automation not found for delay patch', async () => {
    mockGetFoiaAutomation.mockResolvedValueOnce(null);

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        delayDaysOverride: 60,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('Automation record not found');
  });

  it('should update delay and recompute scheduledSendAt', async () => {
    const existing = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
    };
    mockGetFoiaAutomation.mockResolvedValueOnce(existing);
    mockGetOpportunity.mockResolvedValueOnce({
      item: { responseDeadlineIso: '2024-12-01T00:00:00Z' },
      oppId: 'opp-789',
    });
    mockGetSubmissionHistory.mockResolvedValueOnce([
      { submittedAt: '2024-09-01T00:00:00Z' },
    ]);
    mockTransitionFoiaAutomationState.mockResolvedValueOnce({
      ...existing,
      state: 'SCHEDULED',
      delayDaysOverride: 60,
    });

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        delayDaysOverride: 60,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'SCHEDULED',
        patch: expect.objectContaining({
          delayDaysOverride: 60,
        }),
      }),
    );
  });
});
