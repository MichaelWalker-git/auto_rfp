/**
 * Tests for updateRFPDocumentMetadata — focused on the update-expression
 * builder, in particular the Solution Plan stamp fields (ADR-7) added in T8.
 */

// Mock dependencies BEFORE imports
const mockSend = jest.fn();
jest.mock('./db', () => ({ docClient: { send: mockSend } }));
jest.mock('./s3', () => ({ uploadToS3: jest.fn(), loadTextFromS3: jest.fn() }));
jest.mock('./rfp-document-version', () => ({
  createVersion: jest.fn(),
  getLatestVersionNumber: jest.fn(),
  saveVersionHtml: jest.fn(),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

import { updateRFPDocumentMetadata } from './rfp-document';

const baseArgs = {
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  documentId: 'doc-1',
  updatedBy: 'system',
};

/** The UpdateCommand params captured from the docClient.send call. */
const sentUpdateParams = () => {
  const command = mockSend.mock.calls[0]![0] as {
    params: {
      UpdateExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, unknown>;
    };
  };
  return command.params;
};

describe('updateRFPDocumentMetadata — Solution Plan stamp (ADR-7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Attributes: {} });
  });

  it('sets solutionPlanId and solutionPlanVersion when provided', async () => {
    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: {
        htmlContentKey: 'html-key',
        solutionPlanId: 'plan-1',
        solutionPlanVersion: 3,
      },
    });

    const { UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
      sentUpdateParams();

    expect(UpdateExpression).toContain('#solutionPlanId = :solutionPlanId');
    expect(UpdateExpression).toContain('#solutionPlanVersion = :solutionPlanVersion');
    expect(ExpressionAttributeNames['#solutionPlanId']).toBe('solutionPlanId');
    expect(ExpressionAttributeNames['#solutionPlanVersion']).toBe('solutionPlanVersion');
    expect(ExpressionAttributeValues[':solutionPlanId']).toBe('plan-1');
    expect(ExpressionAttributeValues[':solutionPlanVersion']).toBe(3);
  });

  it('omits the stamp fields entirely when not provided', async () => {
    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: { htmlContentKey: 'html-key', generationError: '' },
    });

    const { UpdateExpression, ExpressionAttributeValues } = sentUpdateParams();

    expect(UpdateExpression).not.toContain('solutionPlanId');
    expect(UpdateExpression).not.toContain('solutionPlanVersion');
    expect(ExpressionAttributeValues).not.toHaveProperty(':solutionPlanId');
    expect(ExpressionAttributeValues).not.toHaveProperty(':solutionPlanVersion');
    // Other updates still apply
    expect(UpdateExpression).toContain('#htmlContentKey = :htmlContentKey');
    expect(ExpressionAttributeValues[':htmlContentKey']).toBe('html-key');
  });

  it('always sets updatedAt/updatedBy alongside the requested updates', async () => {
    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: { solutionPlanId: 'plan-1', solutionPlanVersion: 1 },
    });

    const { UpdateExpression, ExpressionAttributeValues } = sentUpdateParams();

    expect(UpdateExpression).toContain('#updatedAt = :now');
    expect(UpdateExpression).toContain('#updatedBy = :updatedBy');
    expect(ExpressionAttributeValues[':updatedBy']).toBe('system');
    expect(ExpressionAttributeValues[':now']).toEqual(expect.any(String));
  });
});

/**
 * A merge resolution once left explicit `templateId`/`furniture` blocks in place
 * *alongside* the generic field loop, so a template-backed generation assigned each
 * attribute twice in one SET clause. DynamoDB rejects that outright:
 *
 *   Invalid UpdateExpression: Two document paths overlap with each other;
 *   path one: [templateId], path two: [templateId]
 *
 * The worker read that ValidationException as a generation failure and retried
 * three times before recording "Generation failed after 3 attempts", so every
 * document that resolved a template failed while plain documents succeeded.
 */
describe('updateRFPDocumentMetadata — no overlapping document paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Attributes: {} });
  });

  /** Every `#name = :value` assignment in the SET clause, as attribute names. */
  const assignedPaths = (updateExpression: string): string[] =>
    [...updateExpression.matchAll(/#(\w+)\s*=/g)].map((match) => match[1]!);

  it('assigns templateId and furniture exactly once each', async () => {
    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: {
        htmlContentKey: 'html-key',
        templateId: 'tpl-1',
        furniture: {
          header: { html: '<p>header</p>', enabled: true },
          footer: { html: '<p>footer</p>', enabled: true },
        },
      },
    });

    const { UpdateExpression } = sentUpdateParams();
    const paths = assignedPaths(UpdateExpression);

    expect(paths.filter((path) => path === 'templateId')).toHaveLength(1);
    expect(paths.filter((path) => path === 'furniture')).toHaveLength(1);
  });

  it('never repeats any attribute path, whatever the caller passes', async () => {
    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: {
        name: 'Doc',
        title: 'Doc',
        content: { title: 'Doc' },
        htmlContentKey: 'html-key',
        generationError: '',
        status: 'READY',
        retryCount: 0,
        solutionPlanId: 'plan-1',
        solutionPlanVersion: 2,
        templateId: 'tpl-1',
        furniture: {
          header: { html: '<p>header</p>', enabled: true },
          footer: { html: '<p>footer</p>', enabled: true },
        },
      },
    });

    const { UpdateExpression } = sentUpdateParams();
    const paths = assignedPaths(UpdateExpression);

    expect(paths).toHaveLength(new Set(paths).size);
  });

  it('persists the template snapshot the export path reads back', async () => {
    const furniture = {
      header: { html: '<p>header</p>', enabled: true },
      footer: { html: '<p>footer</p>', enabled: false },
    };

    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: { templateId: 'tpl-1', furniture },
    });

    const { UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
      sentUpdateParams();

    expect(UpdateExpression).toContain('#templateId = :templateId');
    expect(UpdateExpression).toContain('#furniture = :furniture');
    expect(ExpressionAttributeNames['#templateId']).toBe('templateId');
    expect(ExpressionAttributeNames['#furniture']).toBe('furniture');
    expect(ExpressionAttributeValues[':templateId']).toBe('tpl-1');
    expect(ExpressionAttributeValues[':furniture']).toEqual(furniture);
  });

  it('omits templateId and furniture when the generation resolves no template', async () => {
    await updateRFPDocumentMetadata({
      ...baseArgs,
      updates: { htmlContentKey: 'html-key', status: 'READY' },
    });

    const { UpdateExpression, ExpressionAttributeValues } = sentUpdateParams();

    expect(UpdateExpression).not.toContain('templateId');
    expect(UpdateExpression).not.toContain('furniture');
    expect(ExpressionAttributeValues).not.toHaveProperty(':templateId');
    expect(ExpressionAttributeValues).not.toHaveProperty(':furniture');
  });
});
