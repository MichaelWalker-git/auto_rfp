jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { getOrgPrimaryContact, upsertOrgPrimaryContact, deleteOrgPrimaryContact } from './org-contact';

const ORG_ID = 'org-123';

const SAMPLE_CONTACT = {
  name: 'Jane Smith',
  title: 'VP Contracts',
  email: 'jane@example.com',
  phone: '555-0100',
  orgId: ORG_ID,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('getOrgPrimaryContact', () => {
  it('returns contact when found', async () => {
    mockSend.mockResolvedValueOnce({ Item: SAMPLE_CONTACT });
    const result = await getOrgPrimaryContact(ORG_ID);
    expect(result).toEqual(SAMPLE_CONTACT);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns null when not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getOrgPrimaryContact(ORG_ID);
    expect(result).toBeNull();
  });
});

describe('upsertOrgPrimaryContact', () => {
  it('puts item and returns it', async () => {
    // First call: getOrgPrimaryContact (no existing contact)
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // Second call: putItem
    mockSend.mockResolvedValueOnce({});
    const dto = { name: 'Jane Smith', title: 'VP Contracts', email: 'jane@example.com' };
    const result = await upsertOrgPrimaryContact(ORG_ID, dto, 'user-1');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      name: 'Jane Smith',
      title: 'VP Contracts',
      email: 'jane@example.com',
      orgId: ORG_ID,
      updatedBy: 'user-1',
    });
  });

  it('includes optional phone and address when provided', async () => {
    // First call: getOrgPrimaryContact (no existing contact)
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // Second call: putItem
    mockSend.mockResolvedValueOnce({});
    const dto = { name: 'Jane', title: 'CEO', email: 'jane@co.com', phone: '555-1234', address: '123 Main St' };
    const result = await upsertOrgPrimaryContact(ORG_ID, dto, 'user-1');
    expect(result).toMatchObject({ phone: '555-1234', address: '123 Main St' });
  });
});

describe('deleteOrgPrimaryContact', () => {
  it('sends delete command', async () => {
    mockSend.mockResolvedValueOnce({});
    await deleteOrgPrimaryContact(ORG_ID);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
