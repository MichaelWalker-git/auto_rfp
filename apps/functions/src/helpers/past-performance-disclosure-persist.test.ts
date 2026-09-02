/**
 * Tests for the disclosure persistence helpers in past-performance.ts:
 *  - saveDisclosureProposal writes ONLY disclosureProposed* fields (never
 *    disclosure / disclosureConfirmed) — fail-closed invariant.
 *  - confirmDisclosureRows flips disclosureConfirmed=true, stamps the reviewer,
 *    and skips rows whose project no longer exists.
 */

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.PINECONE_INDEX = 'test-index';

const mockSend = jest.fn();
jest.mock('./db', () => ({
  docClient: { send: (...a: unknown[]) => mockSend(...a) },
}));

// Keep the classifier import cheap and side-effect free.
jest.mock('./embeddings', () => ({ getEmbedding: jest.fn() }));
jest.mock('./pinecone', () => ({ initPineconeClient: jest.fn() }));

import { saveDisclosureProposal, confirmDisclosureRows } from './past-performance';

const ORG = 'org-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({});
});

describe('saveDisclosureProposal', () => {
  it('updates only proposal fields, never disclosure/disclosureConfirmed', async () => {
    await saveDisclosureProposal(ORG, {
      projectId: 'p1',
      proposed: 'ANONYMIZED_ONLY',
      rationale: 'client asked to remain anonymous',
      signals: ['nda'],
      confidence: 80,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const params = mockSend.mock.calls[0][0].input;
    const expr = params.UpdateExpression as string;
    expect(expr).toContain('disclosureProposed');
    expect(expr).toContain('disclosureRationale');
    expect(expr).not.toMatch(/#disclosureConfirmed/);
    // The bare "disclosure" attribute must not be written by the proposal path.
    expect(params.ExpressionAttributeNames['#disclosure']).toBeUndefined();
    expect(params.ExpressionAttributeValues[':proposed']).toBe('ANONYMIZED_ONLY');
    expect(params.ConditionExpression).toContain('attribute_exists');
  });

  it('returns true when the row is updated', async () => {
    const ok = await saveDisclosureProposal(ORG, {
      projectId: 'p1', proposed: 'NAMEABLE', rationale: 'r', signals: [], confidence: 90,
    });
    expect(ok).toBe(true);
  });

  it('returns false (skips) for a hallucinated projectId, without throwing', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' }),
    );
    const ok = await saveDisclosureProposal(ORG, {
      projectId: 'does-not-exist', proposed: 'NAMEABLE', rationale: 'r', signals: [], confidence: 90,
    });
    expect(ok).toBe(false);
  });

  it('rethrows unexpected DynamoDB errors', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }),
    );
    await expect(
      saveDisclosureProposal(ORG, {
        projectId: 'p1', proposed: 'NAMEABLE', rationale: 'r', signals: [], confidence: 90,
      }),
    ).rejects.toThrow('throttled');
  });
});

describe('confirmDisclosureRows', () => {
  it('flips disclosureConfirmed and stamps the reviewer for each row', async () => {
    const updated = await confirmDisclosureRows(
      ORG,
      [
        { projectId: 'p1', disclosure: 'NAMEABLE', disclosureContactNote: 'ok to name' },
        { projectId: 'p2', disclosure: 'DO_NOT_USE' },
      ],
      'reviewer-1',
      '2026-08-17T00:00:00.000Z',
    );

    expect(updated).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const first = mockSend.mock.calls[0][0].input;
    expect(first.ExpressionAttributeValues[':confirmed']).toBe(true);
    expect(first.ExpressionAttributeValues[':reviewedBy']).toBe('reviewer-1');
    expect(first.ExpressionAttributeValues[':reviewedAt']).toBe('2026-08-17T00:00:00.000Z');
    expect(first.ExpressionAttributeValues[':note']).toBe('ok to name');
    // A row without a note persists null.
    const second = mockSend.mock.calls[1][0].input;
    expect(second.ExpressionAttributeValues[':note']).toBeNull();
  });

  it('skips rows whose project no longer exists (ConditionalCheckFailed)', async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' }));

    const updated = await confirmDisclosureRows(
      ORG,
      [
        { projectId: 'p1', disclosure: 'NAMEABLE' },
        { projectId: 'missing', disclosure: 'NAMEABLE' },
      ],
      'reviewer-1',
      '2026-08-17T00:00:00.000Z',
    );

    expect(updated).toBe(1);
  });

  it('rethrows unexpected DynamoDB errors', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));

    await expect(
      confirmDisclosureRows(ORG, [{ projectId: 'p1', disclosure: 'NAMEABLE' }], 'r', 'now'),
    ).rejects.toThrow('throttled');
  });
});
