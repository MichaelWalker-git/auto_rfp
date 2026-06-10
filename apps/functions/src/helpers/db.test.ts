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
