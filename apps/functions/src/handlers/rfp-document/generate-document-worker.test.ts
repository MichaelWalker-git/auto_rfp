/**
 * Tests for the generation worker's retry decision.
 *
 * A malformed request fails identically on every attempt, and each attempt
 * re-runs generation (a fresh Bedrock invocation). These cover the terminal-error
 * path that fails fast instead of spending the retry budget.
 */

// Mock dependencies BEFORE imports
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

const mockSqsSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((params) => ({ type: 'SendMessage', params })),
}));

const mockGetRFPDocument = jest.fn();
const mockUpdateRFPDocumentMetadata = jest.fn();
const mockLoadRFPDocumentHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...args: unknown[]) => mockGetRFPDocument(...args),
  updateRFPDocumentMetadata: (...args: unknown[]) => mockUpdateRFPDocumentMetadata(...args),
  loadRFPDocumentHtml: (...args: unknown[]) => mockLoadRFPDocumentHtml(...args),
}));

const mockProcessJobInner = jest.fn();
jest.mock('@/helpers/generate-document-worker', () => {
  const { z } = jest.requireActual('zod');
  return {
    processJobInner: (...args: unknown[]) => mockProcessJobInner(...args),
    JobSchema: z.object({
      orgId: z.string(),
      projectId: z.string(),
      opportunityId: z.string(),
      documentId: z.string(),
      documentType: z.string(),
      templateId: z.string().optional(),
    }),
  };
});

const mockSendNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  buildNotification: jest.fn((type, title, body) => ({ type, title, body })),
}));

const mockUpdateDocumentStatus = jest.fn();
jest.mock('@/helpers/document-generation', () => {
  const actual = jest.requireActual('@/helpers/document-generation');
  return {
    ...actual,
    updateDocumentStatus: (...args: unknown[]) => mockUpdateDocumentStatus(...args),
  };
});

process.env.DOCUMENT_GENERATION_QUEUE_URL = 'https://sqs.test/queue';
process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

import { handler } from './generate-document-worker';

const job = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  documentId: 'doc-1',
  documentType: 'TECHNICAL_PROPOSAL',
  templateId: 'tpl-1',
};

const sqsEvent = {
  Records: [{ messageId: 'msg-1', body: JSON.stringify(job) }],
} as unknown as Parameters<typeof handler>[0];

/** The `updates` payload of each updateRFPDocumentMetadata call. */
const metadataUpdates = (): Record<string, unknown>[] =>
  mockUpdateRFPDocumentMetadata.mock.calls.map(
    (call) => (call[0] as { updates: Record<string, unknown> }).updates,
  );

const awsError = (name: string, message: string) =>
  Object.assign(new Error(message), { name });

/** The error a duplicated document path in an UpdateExpression produces. */
const overlappingPathError = () =>
  awsError(
    'ValidationException',
    'Invalid UpdateExpression: Two document paths overlap with each other; ' +
      'must remove or rewrite one of these paths; path one: [templateId], path two: [templateId]',
  );

beforeEach(() => {
  jest.clearAllMocks();
  // Fresh document, no prior attempts and no content yet.
  mockGetRFPDocument.mockResolvedValue({
    documentId: 'doc-1',
    retryCount: 0,
    createdBy: 'user-1',
  });
  mockUpdateRFPDocumentMetadata.mockResolvedValue({});
  mockSendNotification.mockResolvedValue(undefined);
  mockSqsSend.mockResolvedValue({});
});

describe('generate-document-worker — terminal errors are not retried', () => {
  it('fails immediately on a malformed UpdateExpression instead of retrying', async () => {
    mockProcessJobInner.mockRejectedValue(overlappingPathError());

    await handler(sqsEvent, {} as never, () => {});

    // No retry was enqueued — this is the whole point: each retry would re-run
    // generation and be rejected identically.
    expect(mockSqsSend).not.toHaveBeenCalled();

    const failed = metadataUpdates().find((u) => u.status === 'FAILED');
    expect(failed).toBeDefined();
    expect(failed!.generationError).toContain('cannot be retried');
    // It must not claim attempts it never made.
    expect(failed!.generationError).not.toContain('after 3 attempts');
  });

  it('surfaces the real cause rather than a generic retry-exhausted message', async () => {
    mockProcessJobInner.mockRejectedValue(overlappingPathError());

    await handler(sqsEvent, {} as never, () => {});

    const failed = metadataUpdates().find((u) => u.status === 'FAILED');
    expect(failed!.generationError).toContain('Two document paths overlap');
  });

  it('still notifies the user who triggered the generation', async () => {
    mockProcessJobInner.mockRejectedValue(overlappingPathError());

    await handler(sqsEvent, {} as never, () => {});

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const { body } = mockSendNotification.mock.calls[0]![0] as { body: string };
    expect(body).toContain('cannot be retried');
  });

  it('does not report the message as a batch failure (SQS must not redeliver)', async () => {
    mockProcessJobInner.mockRejectedValue(overlappingPathError());

    const result = await handler(sqsEvent, {} as never, () => {});

    expect(result).toEqual({ batchItemFailures: [] });
  });
});

describe('generate-document-worker — transient errors still retry', () => {
  it('enqueues a retry for a throttling error', async () => {
    mockProcessJobInner.mockRejectedValue(
      awsError('ThrottlingException', 'Rate exceeded'),
    );

    await handler(sqsEvent, {} as never, () => {});

    expect(mockSqsSend).toHaveBeenCalledTimes(1);

    const retrying = metadataUpdates().find((u) => u.status === 'RETRYING');
    expect(retrying).toBeDefined();
    expect(retrying!.retryCount).toBe(1);

    // Not failed, and no premature notification.
    expect(metadataUpdates().some((u) => u.status === 'FAILED')).toBe(false);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('enqueues a retry for an unrecognised error', async () => {
    mockProcessJobInner.mockRejectedValue(new Error('something odd happened'));

    await handler(sqsEvent, {} as never, () => {});

    expect(mockSqsSend).toHaveBeenCalledTimes(1);
  });

  it('reports retries exhausted once the budget is spent', async () => {
    // Final permitted attempt: MAX_GENERATION_RETRIES is 3, so retryCount 2 has no budget left.
    mockGetRFPDocument.mockResolvedValue({
      documentId: 'doc-1',
      retryCount: 2,
      createdBy: 'user-1',
    });
    mockProcessJobInner.mockRejectedValue(
      awsError('ThrottlingException', 'Rate exceeded'),
    );

    await handler(sqsEvent, {} as never, () => {});

    expect(mockSqsSend).not.toHaveBeenCalled();

    const failed = metadataUpdates().find((u) => u.status === 'FAILED');
    expect(failed!.generationError).toContain('after 3 attempts');
  });
});
