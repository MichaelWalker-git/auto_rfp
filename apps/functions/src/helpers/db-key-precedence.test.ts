/**
 * The key arguments must always win over any key fields carried by the item.
 *
 * This exists because the opposite was true and it broke production: `putItem`
 * spread the caller's item after the keys, so an item holding
 * `partition_key: ''` overwrote a correct pk and DynamoDB rejected the write with
 * "The AttributeValue for a key attribute cannot contain an empty string value."
 *
 * Every FOIA test mocked `putItem`, so the composition was never exercised — the
 * bug was invisible to a green suite. These assertions deliberately call the real
 * helpers and inspect the composed command.
 */
const mockSend = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';

import { createItem, putItem } from './db';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({});
});

const writtenItem = () => mockSend.mock.calls[0]?.[0]?.params?.Item;

describe('putItem key precedence', () => {
  it('ignores empty key fields carried by the item', async () => {
    // Exactly the shape deriveFoiaRequest used to produce.
    await putItem('FOIA_REQUEST', 'org#proj#opp#f-1', {
      partition_key: '',
      sort_key: '',
      foiaId: 'f-1',
    } as never);

    expect(writtenItem().partition_key).toBe('FOIA_REQUEST');
    expect(writtenItem().sort_key).toBe('org#proj#opp#f-1');
  });

  it('ignores non-empty key fields carried by the item', async () => {
    // A stale key from a record read back and re-written under a new key must not
    // silently redirect the write to the old location.
    await putItem('CORRECT_PK', 'correct-sk', {
      partition_key: 'STALE_PK',
      sort_key: 'stale-sk',
      name: 'x',
    } as never);

    expect(writtenItem().partition_key).toBe('CORRECT_PK');
    expect(writtenItem().sort_key).toBe('correct-sk');
  });

  it('still writes the business fields', async () => {
    await putItem('PK', 'SK', { foiaId: 'f-1', agencyName: 'BIA' } as never);

    expect(writtenItem()).toMatchObject({ foiaId: 'f-1', agencyName: 'BIA' });
  });
});

describe('createItem key precedence', () => {
  it('ignores key fields carried by the item', async () => {
    await createItem('PK', 'SK', { partition_key: '', sort_key: '', v: 1 } as never);

    expect(writtenItem().partition_key).toBe('PK');
    expect(writtenItem().sort_key).toBe('SK');
  });
});
