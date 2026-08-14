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
