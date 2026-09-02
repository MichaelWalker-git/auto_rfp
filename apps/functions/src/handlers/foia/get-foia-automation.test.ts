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
import { baseHandler } from './get-foia-automation';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

describe('get-foia-automation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('should return 400 when required params are missing', async () => {
    const event: AuthedEvent = {
      queryStringParameters: { orgId: 'org-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('Missing required query parameters');
  });

  it('should return 200 with null automation when not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event: AuthedEvent = {
      queryStringParameters: {
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
      },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.automation).toBeNull();
  });

  it('should return automation when found', async () => {
    const automation = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
      scheduledSendAt: '2024-12-01T00:00:00Z',
    };
    mockSend.mockResolvedValueOnce({ Item: automation });

    const event: AuthedEvent = {
      queryStringParameters: {
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
      },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.automation).toBeDefined();
    expect(body.automation.state).toBe('SCHEDULED');
  });
});
