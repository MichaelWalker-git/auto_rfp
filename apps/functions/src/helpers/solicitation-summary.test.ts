/**
 * Tests for summarizeSolicitationDocument — the per-document summary used by
 * the Solution Plan's SUMMARIZED solicitation strategy
 * (docs/SOLICITATION-COVERAGE-PLAN.md, Layer B).
 */
const mockInvokeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';

import { summarizeSolicitationDocument } from './solicitation-summary';

const bedrockResponse = (payload: unknown): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  );

const file = { originalFileName: 'RFP.pdf', questionFileId: 'qf-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('summarizeSolicitationDocument', () => {
  it('returns the summary and sections parsed from the model response', async () => {
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({
        summary: 'This RFP solicits cloud migration services for a federal agency. It requires FedRAMP compliance.',
        sections: ['Scope of Work', 'Evaluation Criteria', 'Pricing'],
      }),
    );

    const result = await summarizeSolicitationDocument('org-1', file, 'raw solicitation text'.repeat(100));

    expect(result.summary).toContain('cloud migration');
    expect(result.sections).toEqual(['Scope of Work', 'Evaluation Criteria', 'Pricing']);
  });

  it('threads orgId through to invokeModel as the third argument', async () => {
    mockInvokeModel.mockResolvedValue(bedrockResponse({ summary: 'A summary.', sections: [] }));

    await summarizeSolicitationDocument('the-org-id', file, 'text');

    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'the-org-id');
  });

  it('falls back to the questionFileId when originalFileName is missing', async () => {
    mockInvokeModel.mockResolvedValue(bedrockResponse({ summary: 'A summary.', sections: [] }));

    await summarizeSolicitationDocument('org-1', { questionFileId: 'qf-42' }, 'text');

    const [, body] = mockInvokeModel.mock.calls[0] as [string, string];
    const userText = JSON.parse(body).messages[0].content[0].text as string;
    expect(userText).toContain('qf-42');
  });

  it('truncates the input text before sending it to the model', async () => {
    mockInvokeModel.mockResolvedValue(bedrockResponse({ summary: 'A summary.', sections: [] }));
    const hugeText = 'x'.repeat(100_000);

    await summarizeSolicitationDocument('org-1', file, hugeText);

    const [, body] = mockInvokeModel.mock.calls[0] as [string, string];
    const userText = JSON.parse(body).messages[0].content[0].text as string;
    expect(userText.length).toBeLessThan(hugeText.length);
  });

  it('allows an empty sections list', async () => {
    mockInvokeModel.mockResolvedValue(bedrockResponse({ summary: 'A summary with no clear headings.', sections: [] }));

    const result = await summarizeSolicitationDocument('org-1', file, 'text');

    expect(result.sections).toEqual([]);
  });

  it('rejects a response missing the required summary field', async () => {
    mockInvokeModel.mockResolvedValue(bedrockResponse({ sections: ['A'] }));

    await expect(summarizeSolicitationDocument('org-1', file, 'text')).rejects.toThrow();
  });
});
