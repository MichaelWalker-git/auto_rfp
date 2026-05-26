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

// eslint-disable-next-line no-var
var mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  DeleteObjectsCommand: jest.fn((params) => ({ type: 'S3DeleteObjects', params })),
}));

const mockListQuestionFilesByOpportunity = jest.fn();
const mockDeleteQuestionFile = jest.fn().mockResolvedValue({ ok: true });
jest.mock('@/helpers/questionFile', () => ({
  listQuestionFilesByOpportunity: (...args: unknown[]) => mockListQuestionFilesByOpportunity(...args),
  deleteQuestionFile: (...args: unknown[]) => mockDeleteQuestionFile(...args),
}));

const mockDeleteOpportunity = jest.fn().mockResolvedValue({ ok: true });
jest.mock('@/helpers/opportunity', () => ({
  deleteOpportunity: (...args: unknown[]) => mockDeleteOpportunity(...args),
}));

const mockDeleteOpportunitySolicitationVectors = jest.fn().mockResolvedValue(0);
jest.mock('@/helpers/pinecone', () => ({
  deleteOpportunitySolicitationVectors: (...args: unknown[]) =>
    mockDeleteOpportunitySolicitationVectors(...args),
}));

jest.mock('@/helpers/db', () => ({
  queryBySkPrefix: jest.fn().mockResolvedValue([]),
  deleteItem: jest.fn().mockResolvedValue(undefined),
  batchDeleteItems: jest.fn().mockResolvedValue(undefined),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

import { baseHandler } from './delete-opportunity';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (qs: Record<string, string | undefined>): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: qs,
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
    headers: {},
  }) as unknown as APIGatewayProxyEventV2;

describe('delete-opportunity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListQuestionFilesByOpportunity.mockResolvedValue({ items: [] });
    mockDeleteOpportunitySolicitationVectors.mockResolvedValue(0);
    mockDeleteOpportunity.mockResolvedValue({ ok: true });
  });

  it('returns 400 when orgId is missing', async () => {
    const response = await baseHandler(makeEvent({ projectId: 'proj-1', oppId: 'opp-1' }));
    expect(response).toMatchObject({ statusCode: 400 });
  });

  it('calls deleteOpportunitySolicitationVectors with (orgId, oppId) on happy path', async () => {
    mockDeleteOpportunitySolicitationVectors.mockResolvedValueOnce(7);

    const response = await baseHandler(
      makeEvent({ orgId: 'org-123', projectId: 'proj-1', oppId: 'opp-456' }),
    );

    expect(mockDeleteOpportunitySolicitationVectors).toHaveBeenCalledWith('org-123', 'opp-456');
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.deleted.solicitationVectors).toBe(7);
  });

  it('continues cascade when Pinecone cleanup throws', async () => {
    mockDeleteOpportunitySolicitationVectors.mockRejectedValueOnce(new Error('pinecone down'));

    const response = await baseHandler(
      makeEvent({ orgId: 'org-123', projectId: 'proj-1', oppId: 'opp-456' }),
    );

    expect(response).toMatchObject({ statusCode: 200 });
    expect(mockDeleteOpportunity).toHaveBeenCalledWith({
      orgId: 'org-123',
      projectId: 'proj-1',
      oppId: 'opp-456',
    });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.deleted.solicitationVectors).toBe(0);
  });

  it('invokes Pinecone cleanup after question-file deletion (order matters)', async () => {
    const callOrder: string[] = [];
    mockListQuestionFilesByOpportunity.mockImplementation(async () => {
      callOrder.push('listQuestionFiles');
      return { items: [{ questionFileId: 'qf-1', fileKey: 'k1' }] };
    });
    mockDeleteQuestionFile.mockImplementation(async () => {
      callOrder.push('deleteQuestionFile');
      return { ok: true };
    });
    mockS3Send.mockImplementation(async () => {
      callOrder.push('s3DeleteObjects');
      return {};
    });
    mockDeleteOpportunitySolicitationVectors.mockImplementation(async () => {
      callOrder.push('deleteOppVectors');
      return 0;
    });

    await baseHandler(makeEvent({ orgId: 'org-123', projectId: 'proj-1', oppId: 'opp-456' }));

    const qfIdx = callOrder.lastIndexOf('deleteQuestionFile');
    const oppVectorsIdx = callOrder.indexOf('deleteOppVectors');
    expect(oppVectorsIdx).toBeGreaterThan(qfIdx);
  });
});
