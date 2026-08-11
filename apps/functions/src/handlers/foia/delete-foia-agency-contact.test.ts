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
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './delete-foia-agency-contact';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

describe('delete-foia-agency-contact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('should return 400 when orgId is missing', async () => {
    const event: AuthedEvent = {
      queryStringParameters: { agencyKey: 'DEPT OF DEFENSE' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('Missing required query parameters');
  });

  it('should return 400 when agencyKey is missing', async () => {
    const event: AuthedEvent = {
      queryStringParameters: { orgId: 'org-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toContain('Missing required query parameters');
  });

  it('should delete contact successfully', async () => {
    mockSend.mockResolvedValueOnce({});

    const event: AuthedEvent = {
      queryStringParameters: {
        orgId: 'org-123',
        agencyKey: 'DEPT OF DEFENSE',
      },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toBe('Agency contact deleted');
    expect(body.agencyKey).toBe('DEPT OF DEFENSE');
  });
});
