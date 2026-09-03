// --- Mocks MUST come before imports ---

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

const mockSyncToPartnerCentral = jest.fn();
jest.mock('helpers/apn-client', () => ({
  syncToPartnerCentral: (...args: unknown[]) => mockSyncToPartnerCentral(...args),
}));

// --- Now import the handler ---
import { baseHandler } from './sync';
import { setAuditContext } from 'middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const buildEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent => ({
  body: null,
  headers: {},
  queryStringParameters: null,
  pathParameters: null,
  requestContext: {
    http: { sourceIp: '127.0.0.1', userAgent: 'test' },
  } as AuthedEvent['requestContext'],
  auth: {
    userId: 'user-123',
    userName: 'Test User',
    orgId: 'org-123',
    claims: {},
  },
  ...overrides,
} as AuthedEvent);

const parseBody = (result: { body?: string }) => JSON.parse(result.body ?? '{}');

const validPayload = {
  orgId: 'org-123',
  projectId: 'proj-123',
  oppId: 'opp-123',
  opportunity: {
    title: 'Test Opportunity',
    value: 100000,
    expectedCloseDate: '2026-12-31T00:00:00.000Z',
    status: 'IDENTIFIED',
  },
  customer: {
    name: 'Test Agency',
  },
};

describe('apn/sync baseHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with the sync result on valid input', async () => {
    mockSyncToPartnerCentral.mockResolvedValueOnce({
      apnOpportunityId: 'O0000000001',
      apnSyncError: null,
    });

    const event = buildEvent({ body: JSON.stringify(validPayload) });
    const result = await baseHandler(event);
    const body = parseBody(result as { body: string });

    expect(result).toHaveProperty('statusCode', 200);
    expect(body).toEqual({ ok: true, apnOpportunityId: 'O0000000001', apnSyncError: null });
    expect(mockSyncToPartnerCentral).toHaveBeenCalledWith(validPayload);
  });

  it('returns 200 with ok:false when the sync reports an error', async () => {
    mockSyncToPartnerCentral.mockResolvedValueOnce({
      apnOpportunityId: null,
      apnSyncError: 'Partner Central request failed',
    });

    const event = buildEvent({ body: JSON.stringify(validPayload) });
    const result = await baseHandler(event);
    const body = parseBody(result as { body: string });

    expect(result).toHaveProperty('statusCode', 200);
    expect(body.ok).toBe(false);
    expect(body.apnSyncError).toBe('Partner Central request failed');
  });

  it('returns 400 on malformed JSON body', async () => {
    const event = buildEvent({ body: '{not json' });
    const result = await baseHandler(event);
    const body = parseBody(result as { body: string });

    expect(result).toHaveProperty('statusCode', 400);
    expect(body.error).toBe('Invalid JSON body');
    expect(mockSyncToPartnerCentral).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails schema validation', async () => {
    const event = buildEvent({ body: JSON.stringify({}) });
    const result = await baseHandler(event);
    const body = parseBody(result as { body: string });

    expect(result).toHaveProperty('statusCode', 400);
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toBeDefined();
    expect(mockSyncToPartnerCentral).not.toHaveBeenCalled();
  });

  it('sets audit context with the sync result', async () => {
    mockSyncToPartnerCentral.mockResolvedValueOnce({
      apnOpportunityId: 'O0000000001',
      apnSyncError: null,
    });

    const event = buildEvent({ body: JSON.stringify(validPayload) });
    await baseHandler(event);

    expect(setAuditContext).toHaveBeenCalledWith(event, expect.objectContaining({
      action: 'APN_REGISTRATION_COMPLETED',
      resource: 'apn_registration',
      resourceId: 'opp-123',
      orgId: 'org-123',
    }));
  });
});
