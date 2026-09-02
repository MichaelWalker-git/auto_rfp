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
import { baseHandler } from './upsert-foia-agency-contact';

type AuthedEvent = APIGatewayProxyEventV2 & {
  auth?: { userId?: string };
  rbac?: unknown;
};

describe('upsert-foia-agency-contact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
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
    expect(body.issues).toBeDefined();
  });

  it('should create new contact successfully', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({
      Attributes: {
        orgId: 'org-123',
        agencyName: 'Dept of Defense',
        foiaEmail: 'foia@dod.gov',
        acceptsEmail: true,
      },
    });

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        agencyName: 'Dept of Defense',
        foiaEmail: 'foia@dod.gov',
        foiaAddress: '123 Main St',
        acceptsEmail: true,
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.contact).toBeDefined();
    expect(body.contact.foiaEmail).toBe('foia@dod.gov');
  });

  it('should update existing contact successfully', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        orgId: 'org-123',
        agencyName: 'Dept of Defense',
        foiaEmail: 'old@dod.gov',
        createdAt: '2024-01-01T00:00:00Z',
        createdBy: 'user-001',
      },
    });
    mockSend.mockResolvedValueOnce({
      Attributes: {
        orgId: 'org-123',
        agencyName: 'Dept of Defense',
        foiaEmail: 'new@dod.gov',
      },
    });

    const event: AuthedEvent = {
      body: JSON.stringify({
        orgId: 'org-123',
        agencyName: 'Dept of Defense',
        foiaEmail: 'new@dod.gov',
        foiaAddress: '123 Main St',
      }),
      auth: { userId: 'user-123' },
    } as AuthedEvent;

    const result = await baseHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || '{}');
    expect(body.contact).toBeDefined();
  });
});
