jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

process.env.BEDROCK_MODEL_ID = 'test-model';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

const mockSearchSolicitation = jest.fn();
jest.mock('@/helpers/pinecone', () => ({
  searchSolicitation: (...args: unknown[]) => mockSearchSolicitation(...args),
  SolicitationSearchHit: {} as never,
}));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

const mockSaveChatMessagePair = jest.fn().mockResolvedValue({
  assistantMsg: { messageId: 'msg-1' },
});
jest.mock('@/helpers/opportunity-assistant', () => ({
  saveChatMessagePair: (...args: unknown[]) => mockSaveChatMessagePair(...args),
}));

jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: jest.fn(),
}));

jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
}));

jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('test-secret'),
}));

import { baseHandler } from './chat';

const makeEvent = (qs: Record<string, string>, body: unknown) =>
  ({
    queryStringParameters: qs,
    body: JSON.stringify(body),
    auth: { userId: 'user-1' },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: {},
  }) as never;

describe('chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpportunity.mockResolvedValue({ item: { oppId: 'opp-456' }, oppId: 'opp-456' });
    mockSearchSolicitation.mockResolvedValue([]);
  });

  it('passes orgId as the first arg to searchSolicitation', async () => {
    await baseHandler(
      makeEvent(
        { orgId: 'org-123', projectId: 'proj-1', opportunityId: 'opp-456' },
        { message: 'what is the deadline?' },
      ),
    );

    expect(mockSearchSolicitation).toHaveBeenCalledWith('org-123', 'opp-456', 'what is the deadline?', 5);
  });

  it('returns 400 when orgId query param is missing', async () => {
    const response = await baseHandler(
      makeEvent(
        { projectId: 'proj-1', opportunityId: 'opp-456' } as Record<string, string>,
        { message: 'hi' },
      ),
    );

    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockSearchSolicitation).not.toHaveBeenCalled();
  });
});
