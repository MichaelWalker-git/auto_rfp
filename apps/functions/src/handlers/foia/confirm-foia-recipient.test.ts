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
const mockGetOpportunity = jest.fn();
const mockUpsertAgencyContact = jest.fn();

jest.mock('@/helpers/foia-automation', () => ({
  transitionFoiaAutomationState: (...args: unknown[]) => mockTransitionFoiaAutomationState(...args),
  syncOpportunityFoiaMarker: (...args: unknown[]) => mockSyncOpportunityFoiaMarker(...args),
}));

jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

jest.mock('@/helpers/foia-agency-contact', () => ({
  upsertAgencyContact: (...args: unknown[]) => mockUpsertAgencyContact(...args),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './confirm-foia-recipient';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

describe('confirm-foia-recipient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransitionFoiaAutomationState.mockReset();
    mockSyncOpportunityFoiaMarker.mockReset();
    mockGetOpportunity.mockReset();
    mockUpsertAgencyContact.mockReset();
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

  it('should return 404 when opportunity not found', async () => {
    mockGetOpportunity.mockResolvedValueOnce(undefined);

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        foiaEmail: 'foia@agency.gov',
        foiaAddress: '123 Main St',
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('Opportunity not found');
  });

  it('should confirm recipient and save to directory', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: { organizationName: 'Dept of Defense' },
      oppId: 'opp-789',
    });
    mockUpsertAgencyContact.mockResolvedValueOnce({});
    mockTransitionFoiaAutomationState.mockResolvedValueOnce({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
    });

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        foiaEmail: 'foia@dod.gov',
        foiaAddress: '123 Main St',
        saveToDirectory: true,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockUpsertAgencyContact).toHaveBeenCalledWith(
      'org-123',
      expect.objectContaining({
        agencyName: 'Dept of Defense',
        foiaEmail: 'foia@dod.gov',
      }),
      'user-123',
    );
    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: ['BLOCKED'],
        to: 'SCHEDULED',
        patch: expect.objectContaining({
          recipientSource: 'USER_PROVIDED',
        }),
      }),
    );
  });

  it('should return 409 when transition fails (concurrent update)', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: { organizationName: 'Dept of Defense' },
      oppId: 'opp-789',
    });
    mockTransitionFoiaAutomationState.mockResolvedValueOnce(null);

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        foiaEmail: 'foia@dod.gov',
        foiaAddress: '123 Main St',
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('concurrent');
  });

  it('should skip directory save when saveToDirectory is false', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: { organizationName: 'Dept of Defense' },
      oppId: 'opp-789',
    });
    mockTransitionFoiaAutomationState.mockResolvedValueOnce({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
    });

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        foiaEmail: 'foia@dod.gov',
        foiaAddress: '123 Main St',
        saveToDirectory: false,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    expect(mockUpsertAgencyContact).not.toHaveBeenCalled();
  });
});
