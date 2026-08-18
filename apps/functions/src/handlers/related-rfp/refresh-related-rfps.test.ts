jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));

const mockLambdaSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn(() => ({ send: mockLambdaSend })),
  InvokeCommand: jest.fn((params) => ({ type: 'Invoke', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.FIND_RELATED_RFPS_FUNCTION_NAME = 'find-related-fn';

import { baseHandler } from './refresh-related-rfps';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: unknown): AuthedEvent =>
  ({ body: body === undefined ? undefined : JSON.stringify(body), headers: {} }) as unknown as AuthedEvent;

const validBody = { orgId: 'org', projectId: 'p', oppId: 'o' };

describe('refresh-related-rfps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLambdaSend.mockResolvedValue({});
    process.env.FIND_RELATED_RFPS_FUNCTION_NAME = 'find-related-fn';
  });

  it('returns 400 when body missing', async () => {
    const res = await baseHandler(makeEvent(undefined));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 on validation error', async () => {
    const res = await baseHandler(makeEvent({ orgId: 'org' }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it('returns 500 when function name not configured', async () => {
    delete process.env.FIND_RELATED_RFPS_FUNCTION_NAME;
    const res = await baseHandler(makeEvent(validBody));
    expect(res).toMatchObject({ statusCode: 500 });
  });

  it('fires an async Event invoke and returns 202', async () => {
    const res = await baseHandler(makeEvent(validBody));
    expect(res).toMatchObject({ statusCode: 202 });
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const cmd = mockLambdaSend.mock.calls[0][0];
    expect(cmd.params.InvocationType).toBe('Event');
    expect(cmd.params.FunctionName).toBe('find-related-fn');
    expect(JSON.parse(Buffer.from(cmd.params.Payload).toString())).toEqual(validBody);
  });
});
