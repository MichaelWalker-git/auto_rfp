// Mock middy before imports
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
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './update-foia-settings';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn() })),
  setAuditContext: (...args: unknown[]) => mockSetAuditContext(...args),
}));

describe('update-foia-settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSetAuditContext.mockClear();
  });

  it('should return 400 when orgId is missing', async () => {
    const event: AuthedEvent = {
      pathParameters: undefined,
      body: JSON.stringify({ automationEnabled: false }),
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toBe('orgId is required');
  });

  it('should return 400 when payload is invalid', async () => {
    const event: AuthedEvent = {
      pathParameters: { orgId: 'org-123' },
      body: JSON.stringify({ delayDays: 'invalid' }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toBe('Invalid payload');
    expect(body.issues).toBeDefined();
  });

  it('should update settings successfully', async () => {
    const orgId = 'org-123';
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Attributes: { orgId, automationEnabled: false } });

    const event: AuthedEvent = {
      pathParameters: { orgId },
      body: JSON.stringify({ automationEnabled: false, delayDays: 60 }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.settings).toBeDefined();
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        action: 'ORG_SETTINGS_CHANGED',
        resource: 'organization',
        resourceId: orgId,
      }),
    );
  });
});
