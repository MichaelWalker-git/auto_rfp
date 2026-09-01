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
  assistantMsg: { messageId: '11111111-1111-1111-1111-111111111111' },
});
jest.mock('@/helpers/opportunity-assistant', () => ({
  saveChatMessagePair: (...args: unknown[]) => mockSaveChatMessagePair(...args),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

/** Encode a Bedrock-style response whose text content is the given answer. */
const bedrockResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

const mockLoadTextFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: (...args: unknown[]) => mockLoadTextFromS3(...args),
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
    mockInvokeModel.mockResolvedValue(bedrockResponse('The deadline is next week.'));
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

  it('threads the request orgId through to invokeModel as the third argument', async () => {
    // The model is only invoked when solicitation context exists — provide a hit.
    mockSearchSolicitation.mockResolvedValue([
      {
        metadata: { bucket: 'b', chunkKey: 'k', fileName: 'rfp.pdf', chunkIndex: 0, questionFileId: 'qf-1' },
        score: 0.9,
      },
    ]);
    mockLoadTextFromS3.mockResolvedValue('The deadline is next week.');

    await baseHandler(
      makeEvent(
        { orgId: 'org-123', projectId: 'proj-1', opportunityId: 'opp-456' },
        { message: 'what is the deadline?' },
      ),
    );

    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org-123',
    );
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
