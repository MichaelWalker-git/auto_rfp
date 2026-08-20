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
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './get-foia-settings';
import { buildDefaultFoiaSettings } from '@auto-rfp/core';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

describe('get-foia-settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('should return 400 when orgId is missing', async () => {
    const event: AuthedEvent = {
      pathParameters: undefined,
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toBe('orgId is required');
  });

  it('should return settings when found', async () => {
    const orgId = 'org-123';
    mockSend.mockResolvedValueOnce({
      Item: {
        orgId,
        automationEnabled: true,
        delayDays: 90,
        createdAt: '2024-01-01T00:00:00Z',
      },
    });

    const event: AuthedEvent = {
      pathParameters: { orgId },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.settings).toBeDefined();
    expect(body.settings.orgId).toBe(orgId);
  });

  it('should return default settings when no record exists', async () => {
    const orgId = 'org-123';
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event: AuthedEvent = {
      pathParameters: { orgId },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.settings).toBeDefined();
    expect(body.settings.orgId).toBe(orgId);
    expect(body.settings.automationEnabled).toBe(true);
    expect(body.settings.delayDays).toBe(90);
  });
});
