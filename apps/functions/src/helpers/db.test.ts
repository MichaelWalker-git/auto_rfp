const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  withRetry,
  DEFAULT_MAX_RETRIES,
  getItem,
  createItem,
  deleteItemWithRetry,
  updateItem,
  appendToList,
} from './db';

const makeError = (name: string, message = '') => {
  const err = new Error(message) as Error & { name: string };
  err.name = name;
  return err;
};

const originalSetTimeout = global.setTimeout;

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  // Skip real backoff delays — invoke the callback immediately.
  (global as { setTimeout: unknown }).setTimeout = ((cb: () => void) => {
    cb();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
});

afterEach(() => {
  global.setTimeout = originalSetTimeout;
});

describe('DEFAULT_MAX_RETRIES', () => {
  it('defaults to 3', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(3);
  });
});

describe('withRetry', () => {
  it('returns immediately on success without retrying', async () => {
    const op = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(op);
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors up to maxRetries then succeeds', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(makeError('ProvisionedThroughputExceededException'))
      .mockRejectedValueOnce(makeError('ThrottlingException'))
      .mockResolvedValue('recovered');

    const result = await withRetry(op);
    expect(result).toBe('recovered');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    const op = jest.fn().mockRejectedValue(makeError('ThrottlingException', 'still throttled'));

    await expect(withRetry(op, { maxRetries: 3 })).rejects.toThrow('still throttled');
    // initial attempt + 3 retries
    expect(op).toHaveBeenCalledTimes(4);
  });

  it('does NOT retry non-retryable errors (e.g. ConditionalCheckFailedException)', async () => {
    const op = jest.fn().mockRejectedValue(makeError('ConditionalCheckFailedException'));

    await expect(withRetry(op)).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('treats TransactionConflictException (hot item) as retryable', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(makeError('TransactionConflictException'))
      .mockResolvedValue('ok');

    await expect(withRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('retries on a 5xx $metadata status code', async () => {
    const err = Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 503 } });
    const op = jest.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');

    await expect(withRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('honours a custom maxRetries', async () => {
    const op = jest.fn().mockRejectedValue(makeError('ThrottlingException'));
    await expect(withRetry(op, { maxRetries: 1 })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

describe('getItem retry integration', () => {
  it('retries a throttled GetCommand and returns the item', async () => {
    mockSend
      .mockRejectedValueOnce(makeError('ProvisionedThroughputExceededException'))
      .mockResolvedValue({ Item: { id: 'x' } });

    const result = await getItem('PK', 'SK');
    expect(result).toEqual({ id: 'x' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('createItem retry integration', () => {
  it('does not retry a ConditionalCheckFailedException', async () => {
    mockSend.mockRejectedValue(makeError('ConditionalCheckFailedException'));

    await expect(createItem('PK', 'SK', { foo: 'bar' })).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('updateItem expression attribute pruning', () => {
  const sentCommandParams = () =>
    (mockSend.mock.calls[0][0] as { params: Record<string, any> }).params;

  it('keeps the seeded #pk/#sk names when the default condition is used', async () => {
    mockSend.mockResolvedValue({ Attributes: {} });

    await updateItem('PK', 'SK', { name: 'x' });

    const params = sentCommandParams();
    expect(params.ConditionExpression).toBe('attribute_exists(#pk) AND attribute_exists(#sk)');
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#pk': expect.any(String),
      '#sk': expect.any(String),
      '#name': 'name',
    });
  });

  it('drops seeded names a custom condition does not reference (regression: unused #sk)', async () => {
    mockSend.mockResolvedValue({ Attributes: {} });

    await updateItem(
      'PK',
      'SK',
      { isStale: true },
      {
        condition: 'attribute_exists(#pk) AND #status = :readyStatus',
        conditionNames: { '#pk': 'partition_key', '#status': 'status' },
        conditionValues: { ':readyStatus': 'READY' },
      },
    );

    const params = sentCommandParams();
    expect(params.ExpressionAttributeNames).not.toHaveProperty('#sk');
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#pk': 'partition_key',
      '#status': 'status',
      '#isStale': 'isStale',
    });
    expect(params.ExpressionAttributeValues).toMatchObject({
      ':readyStatus': 'READY',
      ':isStale': true,
    });
  });

  it('does not confuse names that share a prefix (#s vs #status)', async () => {
    mockSend.mockResolvedValue({ Attributes: {} });

    await updateItem(
      'PK',
      'SK',
      { status: 'READY' },
      {
        condition: 'attribute_exists(#pk) AND #s = :s',
        conditionNames: { '#pk': 'partition_key', '#s': 'shortField' },
        conditionValues: { ':s': 1 },
      },
    );

    const params = sentCommandParams();
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#s': 'shortField',
      '#status': 'status',
    });
    expect(params.ExpressionAttributeNames).not.toHaveProperty('#sk');
  });
});

describe('appendToList', () => {
  it('emits a list_append UpdateCommand touching only the target attribute + updatedAt', async () => {
    mockSend.mockResolvedValue({ Attributes: { appliedEditIds: ['e1', 'e2'] } });

    const result = await appendToList('PK', 'SK', 'appliedEditIds', ['e2']);

    expect(result).toEqual({ appliedEditIds: ['e1', 'e2'] });
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.type).toBe('Update');
    // list_append(if_not_exists(...)) so a concurrent append can't clobber.
    expect(cmd.params.UpdateExpression).toContain('list_append(if_not_exists(#attr, :empty), :items)');
    expect(cmd.params.ExpressionAttributeNames['#attr']).toBe('appliedEditIds');
    expect(cmd.params.ExpressionAttributeValues[':items']).toEqual(['e2']);
    // Guarded on item existence (mirrors updateItem).
    expect(cmd.params.ConditionExpression).toContain('attribute_exists(#pk)');
    // Only the attribute + updatedAt are set — no sibling fields.
    expect(cmd.params.UpdateExpression).not.toContain('#status');
  });

  it('does not retry a ConditionalCheckFailedException (missing item)', async () => {
    mockSend.mockRejectedValue(makeError('ConditionalCheckFailedException'));
    await expect(appendToList('PK', 'SK', 'appliedEditIds', ['e1'])).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('deleteItemWithRetry', () => {
  it('returns true on success', async () => {
    mockSend.mockResolvedValue({});
    await expect(deleteItemWithRetry('PK', 'SK')).resolves.toBe(true);
  });

  it('returns false when a non-retryable error persists', async () => {
    mockSend.mockRejectedValue(makeError('ValidationException', 'bad key'));
    await expect(deleteItemWithRetry('PK', 'SK')).resolves.toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors then returns true', async () => {
    mockSend
      .mockRejectedValueOnce(makeError('ThrottlingException'))
      .mockResolvedValue({});
    await expect(deleteItemWithRetry('PK', 'SK')).resolves.toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
