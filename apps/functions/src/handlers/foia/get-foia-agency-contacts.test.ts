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
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './get-foia-agency-contacts';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

describe('get-foia-agency-contacts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('should return 400 when orgId is missing', async () => {
    const event: AuthedEvent = {
      queryStringParameters: undefined,
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || '{}');
    expect(body.message).toBe('orgId is required');
  });

  it('should return empty array when no contacts found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event: AuthedEvent = {
      queryStringParameters: { orgId: 'org-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.contacts).toEqual([]);
  });

  it('should return contacts when found', async () => {
    const contacts = [
      {
        orgId: 'org-123',
        agencyKey: 'DEPT OF DEFENSE',
        agencyName: 'Dept of Defense',
        foiaEmail: 'foia@dod.gov',
        acceptsEmail: true,
      },
    ];
    mockSend.mockResolvedValueOnce({ Items: contacts });

    const event: AuthedEvent = {
      queryStringParameters: { orgId: 'org-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].agencyKey).toBe('DEPT OF DEFENSE');
  });
});
