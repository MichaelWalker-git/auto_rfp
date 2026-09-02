const mockProbeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  probeModel: (...args: unknown[]) => mockProbeModel(...args),
}));

process.env.BEDROCK_EMBEDDING_MODEL_ID = 'titan-embed';
process.env.BEDROCK_MODEL_ID = 'opus';
process.env.BEDROCK_CHAT_MODEL_ID = 'haiku';
process.env.BEDROCK_WORKER_MODEL_ID = 'sonnet';

import { probeBedrockKey } from './bedrock-probe';

const TEXT = ['opus', 'haiku', 'sonnet'];

/**
 * Drive `probeModel` per-model: `okModels` invoke successfully, everything else
 * fails with AccessDeniedException.
 */
const probeReturns = (okModels: string[]) => {
  mockProbeModel.mockImplementation((modelId: string) =>
    okModels.includes(modelId)
      ? Promise.resolve({ ok: true })
      : Promise.resolve({ ok: false, error: 'AccessDeniedException' }),
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProbeModel.mockReset();
});

describe('probeBedrockKey — acceptance rule (ADR-004)', () => {
  it('accepts when titan + all text models are invokable (no fallback needed)', async () => {
    probeReturns(['titan-embed', ...TEXT]);

    const res = await probeBedrockKey({ apiKey: 'k' });

    expect(res.accepted).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.probe.accepted).toBe(true);
    expect(res.probe.results).toHaveLength(4);
    // Never probes a fallback when none supplied.
    expect(mockProbeModel).toHaveBeenCalledTimes(4);
    expect(mockProbeModel).toHaveBeenCalledWith('titan-embed', 'k');
  });

  it('rejects when titan-embed is not invokable (no embeddings fallback)', async () => {
    probeReturns(TEXT); // titan fails

    const res = await probeBedrockKey({ apiKey: 'k', fallbackModelId: 'fb' });

    expect(res.accepted).toBe(false);
    expect(res.missing).toContain('titan-embed');
  });

  it('accepts when a text model is missing but a working fallback is supplied', async () => {
    probeReturns(['titan-embed', 'opus', 'sonnet', 'fb']); // haiku missing, fb works

    const res = await probeBedrockKey({ apiKey: 'k', fallbackModelId: 'fb' });

    expect(res.accepted).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.probe.results.some((r) => r.role === 'fallback' && r.ok)).toBe(true);
  });

  it('rejects with the exact missing text models when a text model is missing and no fallback is supplied', async () => {
    probeReturns(['titan-embed', 'opus']); // haiku + sonnet missing

    const res = await probeBedrockKey({ apiKey: 'k' });

    expect(res.accepted).toBe(false);
    expect(res.missing.sort()).toEqual(['haiku', 'sonnet']);
  });

  it('rejects when a text model is missing and the supplied fallback also fails', async () => {
    probeReturns(['titan-embed', 'opus', 'sonnet']); // haiku missing, fb fails

    const res = await probeBedrockKey({ apiKey: 'k', fallbackModelId: 'fb' });

    expect(res.accepted).toBe(false);
    expect(res.missing).toEqual(['haiku']);
    expect(res.probe.results.some((r) => r.role === 'fallback' && !r.ok)).toBe(true);
  });

  it('probes with the submitted key and records per-model errors', async () => {
    probeReturns(['titan-embed', 'opus', 'haiku']); // sonnet missing

    const res = await probeBedrockKey({ apiKey: 'submitted-key' });

    expect(mockProbeModel).toHaveBeenCalledWith('sonnet', 'submitted-key');
    const sonnet = res.probe.results.find((r) => r.modelId === 'sonnet');
    expect(sonnet).toMatchObject({ role: 'worker', ok: false, error: 'AccessDeniedException' });
  });
});
