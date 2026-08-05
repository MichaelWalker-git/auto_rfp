const mockReadDocumentPrompt = jest.fn();
jest.mock('./prompt', () => ({
  readDocumentPrompt: mockReadDocumentPrompt,
}));

import { resolveDocumentPromptFragments } from './document-prompt-overrides';

const ORG_ID = 'org-123';

beforeEach(() => {
  jest.clearAllMocks();
  mockReadDocumentPrompt.mockReset();
});

describe('resolveDocumentPromptFragments', () => {
  it('returns both fragments when SYSTEM and USER overrides exist', async () => {
    mockReadDocumentPrompt.mockImplementation(async (_orgId, scope) =>
      scope === 'SYSTEM'
        ? { prompt: 'Custom guidance' }
        : { prompt: 'Custom task' },
    );

    const result = await resolveDocumentPromptFragments(ORG_ID, 'COST_PROPOSAL');

    expect(result).toEqual({ guidance: 'Custom guidance', task: 'Custom task' });
    expect(mockReadDocumentPrompt).toHaveBeenCalledTimes(2);
    expect(mockReadDocumentPrompt).toHaveBeenCalledWith(ORG_ID, 'SYSTEM', 'COST_PROPOSAL');
    expect(mockReadDocumentPrompt).toHaveBeenCalledWith(ORG_ID, 'USER', 'COST_PROPOSAL');
  });

  it('returns a partial result when only one scope is overridden', async () => {
    mockReadDocumentPrompt.mockImplementation(async (_orgId, scope) =>
      scope === 'SYSTEM' ? { prompt: 'Custom guidance' } : null,
    );

    const result = await resolveDocumentPromptFragments(ORG_ID, 'COVER_LETTER');

    expect(result).toEqual({ guidance: 'Custom guidance', task: null });
  });

  it('returns nulls when no overrides exist', async () => {
    mockReadDocumentPrompt.mockResolvedValue(null);

    const result = await resolveDocumentPromptFragments(ORG_ID, 'TECHNICAL_PROPOSAL');

    expect(result).toEqual({ guidance: null, task: null });
  });

  it('trims fragment text and treats whitespace-only overrides as absent', async () => {
    mockReadDocumentPrompt.mockImplementation(async (_orgId, scope) =>
      scope === 'SYSTEM' ? { prompt: '  padded guidance  ' } : { prompt: '   ' },
    );

    const result = await resolveDocumentPromptFragments(ORG_ID, 'PRICE_VOLUME');

    expect(result).toEqual({ guidance: 'padded guidance', task: null });
  });

  it('treats empty-string prompts as absent', async () => {
    mockReadDocumentPrompt.mockResolvedValue({ prompt: '' });

    const result = await resolveDocumentPromptFragments(ORG_ID, 'APPENDICES');

    expect(result).toEqual({ guidance: null, task: null });
  });

  it('returns nulls without reading DynamoDB for unknown/custom document types', async () => {
    const result = await resolveDocumentPromptFragments(ORG_ID, 'MY_CUSTOM_TYPE');

    expect(result).toEqual({ guidance: null, task: null });
    expect(mockReadDocumentPrompt).not.toHaveBeenCalled();
  });

  it('returns nulls without reading DynamoDB for excluded pipeline types', async () => {
    const result = await resolveDocumentPromptFragments(ORG_ID, 'CLARIFYING_QUESTIONS');

    expect(result).toEqual({ guidance: null, task: null });
    expect(mockReadDocumentPrompt).not.toHaveBeenCalled();
  });

  it('never throws on a DynamoDB read error — logs a warning and falls back to nulls', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockReadDocumentPrompt.mockRejectedValue(new Error('DDB unavailable'));

    const result = await resolveDocumentPromptFragments(ORG_ID, 'COST_PROPOSAL');

    expect(result).toEqual({ guidance: null, task: null });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Override read failed for COST_PROPOSAL'),
      'DDB unavailable',
    );
    warnSpy.mockRestore();
  });
});
