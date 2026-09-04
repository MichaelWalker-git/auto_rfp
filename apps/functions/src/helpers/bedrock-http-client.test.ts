/**
 * Seam-1 tests for the per-org Bedrock resolution (ticket 09).
 *
 * These assert OBSERVABLE behavior — which key/model each HTTP request carried,
 * how many key fetches happened, and which errors surface — rather than cache
 * internals. `https.request` and the key/config stores are mocked so no network
 * or AWS call is made.
 *
 * NOTE: the module under test keeps a process-level key cache. We do NOT reset
 * modules between tests (that would rebind the mocked stores to a fresh copy);
 * instead every test uses a UNIQUE orgId so no cache state leaks across tests.
 */
import https from 'https';

jest.mock('https');
jest.mock('./api-key-storage');
jest.mock('./bedrock-config');
jest.mock('@/sentry-lambda', () => ({
  TransientServiceError: class TransientServiceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'TransientServiceError';
      this.statusCode = statusCode;
    }
  },
}));

import { getApiKey as getStoredApiKey } from './api-key-storage';
import { getBedrockConfig } from './bedrock-config';
import { invokeModel } from './bedrock-http-client';
import { AiNotConfiguredError } from './ai-config-error';

const mockGetStoredApiKey = getStoredApiKey as jest.MockedFunction<typeof getStoredApiKey>;
const mockGetBedrockConfig = getBedrockConfig as jest.MockedFunction<typeof getBedrockConfig>;
const mockHttpsRequest = https.request as unknown as jest.Mock;

// ─── https.request fake ─────────────────────────────────────────────────────
// Each entry is the response for the next request, in order.
type FakeResponse = { statusCode: number; body: string };
let responseQueue: FakeResponse[] = [];
// Records the Authorization header + path (model) of every request made.
let requests: Array<{ authorization?: string; path?: string }> = [];

const setResponses = (...responses: FakeResponse[]) => {
  responseQueue = [...responses];
};

const ok = (body = '{"content":[{"type":"text","text":"ok"}]}'): FakeResponse => ({
  statusCode: 200,
  body,
});
const err = (statusCode: number, body = ''): FakeResponse => ({ statusCode, body });

beforeEach(() => {
  jest.clearAllMocks();
  responseQueue = [];
  requests = [];

  mockHttpsRequest.mockImplementation(
    (options: { headers?: Record<string, unknown>; path?: string }, cb: (res: unknown) => void) => {
      const authHeader = options.headers?.['Authorization'];
      requests.push({
        authorization: typeof authHeader === 'string' ? authHeader : undefined,
        path: options.path,
      });
      const response = responseQueue.shift() ?? ok();

      const res = {
        statusCode: response.statusCode,
        statusMessage: 'test',
        on: (event: string, handler: (arg?: Buffer) => void) => {
          if (event === 'data') handler(Buffer.from(response.body));
          if (event === 'end') handler();
          return res;
        },
      };
      process.nextTick(() => cb(res));

      return { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn() };
    },
  );
});

const TEXT_MODEL = 'us.anthropic.claude-opus-4-6-v1';
const EMBED_MODEL = 'amazon.titan-embed-text-v2:0';

describe('invokeModel per-org resolution (ticket 09)', () => {
  it('uses each org’s own key — org A never sends org B’s key', async () => {
    mockGetStoredApiKey.mockImplementation(async (orgId: string) =>
      orgId === 'org-key-a' ? 'KEY_A' : 'KEY_B',
    );
    setResponses(ok(), ok());

    await invokeModel(TEXT_MODEL, '{}', 'org-key-a');
    await invokeModel(TEXT_MODEL, '{}', 'org-key-b');

    expect(requests[0]?.authorization).toBe('Bearer KEY_A');
    expect(requests[1]?.authorization).toBe('Bearer KEY_B');
  });

  it('throws AiNotConfiguredError when the org has no key', async () => {
    mockGetStoredApiKey.mockResolvedValue(null);

    await expect(invokeModel(TEXT_MODEL, '{}', 'org-none')).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
    // No HTTP request is attempted when there is no key.
    expect(requests).toHaveLength(0);
  });

  it('caches the key within TTL — a second invoke does not re-fetch', async () => {
    mockGetStoredApiKey.mockResolvedValue('KEY_CACHE');
    setResponses(ok(), ok());

    await invokeModel(TEXT_MODEL, '{}', 'org-cache');
    await invokeModel(TEXT_MODEL, '{}', 'org-cache');

    expect(mockGetStoredApiKey).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
  });

  it('re-fetches after the TTL expires', async () => {
    mockGetStoredApiKey.mockResolvedValue('KEY_TTL');
    setResponses(ok(), ok());
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    await invokeModel(TEXT_MODEL, '{}', 'org-ttl');
    // Jump past the ~5 min TTL.
    nowSpy.mockReturnValue(1_000_000 + 6 * 60 * 1000);
    await invokeModel(TEXT_MODEL, '{}', 'org-ttl');

    expect(mockGetStoredApiKey).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('on a 401 evicts the cached key, re-fetches once, and retries', async () => {
    mockGetStoredApiKey.mockResolvedValueOnce('STALE_KEY').mockResolvedValueOnce('FRESH_KEY');
    setResponses(err(401), ok());

    await invokeModel(TEXT_MODEL, '{}', 'org-401');

    expect(mockGetStoredApiKey).toHaveBeenCalledTimes(2);
    expect(requests[0]?.authorization).toBe('Bearer STALE_KEY');
    expect(requests[1]?.authorization).toBe('Bearer FRESH_KEY');
  });

  it('retries a text-role ResourceNotFound once on the org’s fallback model', async () => {
    mockGetStoredApiKey.mockResolvedValue('KEY_FB');
    mockGetBedrockConfig.mockResolvedValue({
      fallbackModelId: 'us.anthropic.claude-sonnet-4-6',
    } as never);
    setResponses(err(404, '{"__type":"ResourceNotFoundException"}'), ok());

    await invokeModel(TEXT_MODEL, '{}', 'org-fb');

    expect(requests[0]?.path).toContain(TEXT_MODEL);
    expect(requests[1]?.path).toContain('us.anthropic.claude-sonnet-4-6');
  });

  it('does NOT fall back for embeddings — a titan failure is a hard error', async () => {
    mockGetStoredApiKey.mockResolvedValue('KEY_EMB');
    mockGetBedrockConfig.mockResolvedValue({
      fallbackModelId: 'us.anthropic.claude-sonnet-4-6',
    } as never);
    setResponses(err(404, '{"__type":"ResourceNotFoundException"}'));

    await expect(invokeModel(EMBED_MODEL, '{}', 'org-emb')).rejects.toThrow();
    // Only the single embedding attempt — no fallback retry.
    expect(requests).toHaveLength(1);
    expect(mockGetBedrockConfig).not.toHaveBeenCalled();
  });

  it('preserves the throttling retry (429 → success)', async () => {
    mockGetStoredApiKey.mockResolvedValue('KEY_THROTTLE');
    setResponses(err(429, 'ThrottlingException'), ok());

    await invokeModel(TEXT_MODEL, '{}', 'org-throttle');

    expect(requests).toHaveLength(2);
    expect(requests[0]?.authorization).toBe('Bearer KEY_THROTTLE');
    expect(requests[1]?.authorization).toBe('Bearer KEY_THROTTLE');
  }, 15000);

  it('retries transient 5xx responses with backoff and then succeeds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    try {
      mockGetStoredApiKey.mockResolvedValue('KEY_5XX');
      const successBody = '{"content":[{"type":"text","text":"recovered"}]}';
      setResponses(err(503, 'Service Unavailable'), err(503, 'Service Unavailable'), ok(successBody));

      const resultPromise = invokeModel(TEXT_MODEL, '{}', 'org-5xx');
      // Advance through THROTTLE_RETRY_DELAYS_MS = [2000, 5000, 12000] for the two 503 retries.
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;

      expect(new TextDecoder('utf-8').decode(result)).toBe(successBody);
      expect(requests).toHaveLength(3);
      expect(requests[0]?.authorization).toBe('Bearer KEY_5XX');
      expect(requests[1]?.authorization).toBe('Bearer KEY_5XX');
      expect(requests[2]?.authorization).toBe('Bearer KEY_5XX');
    } finally {
      jest.useRealTimers();
    }
  });
});
