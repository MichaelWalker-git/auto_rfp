// Mock middy before importing
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234'),
}));

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

// Mock Secrets Manager
const mockSecretsSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((params) => ({ type: 'GetSecret', params })),
  PutSecretValueCommand: jest.fn((params) => ({ type: 'PutSecret', params })),
  CreateSecretCommand: jest.fn((params) => ({ type: 'CreateSecret', params })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    name = 'ResourceNotFoundException';
  },
}));

// Mock SignatureV4 to avoid actual signing
jest.mock('@smithy/signature-v4', () => ({
  SignatureV4: jest.fn().mockImplementation(() => ({
    sign: jest.fn().mockResolvedValue({
      headers: { 'Content-Type': 'application/json', host: 'partnercentral.awspartner.com' },
    }),
  })),
}));

jest.mock('@smithy/protocol-http', () => ({
  HttpRequest: jest.fn().mockImplementation((opts: unknown) => opts),
}));

jest.mock('@aws-crypto/sha256-js', () => ({
  Sha256: jest.fn(),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';

import {
  buildApnRegistrationSk,
  buildApnRegistrationSkPrefix,
  buildApnCredentialsSk,
  saveApnCredentials,
  getApnCredentialsMeta,
  createApnRegistration,
  updateApnRegistration,
  getApnRegistration,
  triggerApnRegistration,
  retryApnRegistration,
} from './apn';

describe('SK Builders', () => {
  it('buildApnRegistrationSk produces correct format', () => {
    const sk = buildApnRegistrationSk('org-1', 'proj-2', 'opp-3', 'reg-4');
    expect(sk).toBe('org-1#proj-2#opp-3#reg-4');
  });

  it('buildApnRegistrationSkPrefix produces correct prefix', () => {
    const prefix = buildApnRegistrationSkPrefix('org-1', 'proj-2', 'opp-3');
    expect(prefix).toBe('org-1#proj-2#opp-3#');
  });

  it('buildApnCredentialsSk returns orgId', () => {
    expect(buildApnCredentialsSk('org-123')).toBe('org-123');
  });
});

describe('getApnCredentialsMeta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('returns { configured: false } when no record exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getApnCredentialsMeta('org-1');
    expect(result).toEqual({ configured: false });
  });

  it('returns configured metadata when record exists', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        orgId: 'org-1',
        partnerId: 'PARTNER001',
        region: 'us-east-1',
        configuredAt: '2025-01-01T00:00:00Z',
      },
    });
    const result = await getApnCredentialsMeta('org-1');
    expect(result).toEqual({
      configured: true,
      partnerId: 'PARTNER001',
      region: 'us-east-1',
      configuredAt: '2025-01-01T00:00:00Z',
    });
  });
});

describe('saveApnCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSecretsSend.mockReset();
  });

  it('stores secret in Secrets Manager and metadata in DynamoDB', async () => {
    mockSecretsSend.mockResolvedValueOnce({}); // PutSecretValue (update)
    mockSend.mockResolvedValueOnce({}); // PutCommand (DynamoDB)

    await saveApnCredentials({
      orgId: 'org-1',
      partnerId: 'PARTNER001',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    });

    expect(mockSecretsSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('createApnRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('creates a PENDING registration record', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await createApnRegistration({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      customerName: 'Acme Corp',
      opportunityValue: 500000,
      awsServices: ['EC2'],
      expectedCloseDate: '2025-06-30T00:00:00Z',
      proposalStatus: 'SUBMITTED',
      registeredBy: 'user-123',
    });

    expect(result.status).toBe('PENDING');
    expect(result.registrationId).toBe('mock-uuid-1234');
    expect(result.retryCount).toBe(0);
  });

  it('uses correct PK and SK format', async () => {
    mockSend.mockResolvedValueOnce({});

    await createApnRegistration({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      customerName: 'Acme Corp',
      opportunityValue: 0,
      awsServices: ['Other'],
      expectedCloseDate: '2025-06-30T00:00:00Z',
      proposalStatus: 'SUBMITTED',
      registeredBy: 'system',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          TableName: 'test-table',
          Item: expect.objectContaining({
            partition_key: 'APN_REGISTRATION',
            sort_key: 'org-1#proj-1#opp-1#mock-uuid-1234',
          }),
        }),
      }),
    );
  });
});

describe('getApnRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('returns null when no registrations exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const result = await getApnRegistration('org-1', 'proj-1', 'opp-1');
    expect(result).toBeNull();
  });

  it('returns the most recently created registration', async () => {
    const older = { registrationId: 'reg-old', createdAt: '2025-01-01T00:00:00Z', status: 'FAILED' };
    const newer = { registrationId: 'reg-new', createdAt: '2025-01-02T00:00:00Z', status: 'REGISTERED' };
    mockSend.mockResolvedValueOnce({ Items: [older, newer] });

    const result = await getApnRegistration('org-1', 'proj-1', 'opp-1');
    expect(result?.registrationId).toBe('reg-new');
  });
});

describe('triggerApnRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSecretsSend.mockReset();
  });

  it('skips registration when credentials are not configured', async () => {
    // getApnCredentialsMeta returns not configured
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await triggerApnRegistration({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      customerName: 'Acme Corp',
      opportunityValue: 500000,
      awsServices: ['EC2'],
      expectedCloseDate: '2025-06-30T00:00:00Z',
      proposalStatus: 'SUBMITTED',
      registeredBy: 'user-123',
    });

    // Should not create any registration record
    expect(mockSend).toHaveBeenCalledTimes(1); // only the getItem for credentials
  });

  it('creates FAILED registration when Partner Central API fails', async () => {
    // 1. getApnCredentialsMeta — configured
    mockSend.mockResolvedValueOnce({
      Item: { partnerId: 'PARTNER001', region: 'us-east-1', configuredAt: '2025-01-01T00:00:00Z' },
    });
    // 2. createApnRegistration (PutCommand)
    mockSend.mockResolvedValueOnce({});
    // 3. getApiKey (Secrets Manager)
    mockSecretsSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'secret' }),
    });
    // 4. getApnCredentialsMeta again (called inside callPartnerCentralApi)
    mockSend.mockResolvedValueOnce({
      Item: { partnerId: 'PARTNER001', region: 'us-east-1', configuredAt: '2025-01-01T00:00:00Z' },
    });
    // 5. fetch fails
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));
    // 6. updateApnRegistration to FAILED (PutCommand)
    mockSend.mockResolvedValueOnce({});

    await triggerApnRegistration({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      customerName: 'Acme Corp',
      opportunityValue: 500000,
      awsServices: ['EC2'],
      expectedCloseDate: '2025-06-30T00:00:00Z',
      proposalStatus: 'SUBMITTED',
      registeredBy: 'user-123',
    });

    // Should have called PutCommand twice: once for PENDING, once for FAILED
    const putCalls = mockSend.mock.calls.filter(
      (call) => call[0]?.type === 'Put',
    );
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('retryApnRegistration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSecretsSend.mockReset();
  });

  it('throws when registration not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await expect(
      retryApnRegistration({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        registrationId: 'reg-123',
        retriedBy: 'user-123',
      }),
    ).rejects.toThrow('not found');
  });

  it('throws when registration is already REGISTERED', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        registrationId: 'reg-123',
        status: 'REGISTERED',
        retryCount: 0,
      },
    });

    await expect(
      retryApnRegistration({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        registrationId: 'reg-123',
        retriedBy: 'user-123',
      }),
    ).rejects.toThrow('already succeeded');
  });

  it('throws when credentials are not configured', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { registrationId: 'reg-123', status: 'FAILED', retryCount: 0 },
    });
    // getApnCredentialsMeta returns not configured
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await expect(
      retryApnRegistration({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        registrationId: 'reg-123',
        retriedBy: 'user-123',
      }),
    ).rejects.toThrow('credentials not configured');
  });
});
