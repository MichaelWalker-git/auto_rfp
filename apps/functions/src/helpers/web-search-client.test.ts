/**
 * Tests for the provider-agnostic web search client (Brave + Tavily providers).
 * Mocks SSM (API keys) and https (provider APIs) so we can assert provider
 * selection via WEB_SEARCH_PROVIDER, normalization, key caching, the single
 * retry on 429, and unknown-provider degradation.
 */
import { EventEmitter } from 'events';

const mockSsmSend = jest.fn();
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: jest.fn((params) => ({ type: 'GetParameter', params })),
}));

type QueuedResponse = { statusCode: number; body: string };
const responseQueue: QueuedResponse[] = [];
const mockHttpsRequest = jest.fn();
const writtenBodies: string[] = [];

jest.mock('https', () => ({
  __esModule: true,
  default: {
    request: (options: unknown, onResponse: (res: EventEmitter & { statusCode: number; statusMessage?: string }) => void) => {
      mockHttpsRequest(options);
      const req = new EventEmitter() as EventEmitter & { end: () => void; write: (b: unknown) => void };
      req.write = (b: unknown) => {
        writtenBodies.push(String(b));
      };
      req.end = () => {
        const next = responseQueue.shift();
        if (!next) throw new Error('No queued response');
        const res = new EventEmitter() as EventEmitter & { statusCode: number; statusMessage?: string };
        res.statusCode = next.statusCode;
        // Deliver asynchronously, as a real socket would
        setImmediate(() => {
          res.emit('data', Buffer.from(next.body));
          res.emit('end');
        });
        onResponse(res);
      };
      return req;
    },
  },
}));

process.env.REGION = 'us-east-1';
process.env.BRAVE_SEARCH_API_KEY_SSM_PARAM = '/auto-rfp/brave-search/api-key';
process.env.TAVILY_API_KEY_SSM_PARAM = '/auto-rfp/tavily/api-key';

import { webSearch, __resetWebSearchApiKeyCacheForTests } from './web-search-client';

const braveBody = (results: Array<{ title?: string; url?: string; description?: string }>) =>
  JSON.stringify({ web: { results } });

const tavilyBody = (results: Array<{ title?: string; url?: string; content?: string }>) =>
  JSON.stringify({ results });

beforeEach(() => {
  jest.clearAllMocks();
  responseQueue.length = 0;
  writtenBodies.length = 0;
  __resetWebSearchApiKeyCacheForTests();
  mockSsmSend.mockResolvedValue({ Parameter: { Value: 'test-key' } });
});

afterEach(() => {
  delete process.env.WEB_SEARCH_PROVIDER;
});

describe('webSearch provider selection', () => {
  it('defaults to tavily when WEB_SEARCH_PROVIDER is unset', async () => {
    delete process.env.WEB_SEARCH_PROVIDER;
    responseQueue.push({ statusCode: 200, body: tavilyBody([]) });

    await webSearch('q');

    const options = mockHttpsRequest.mock.calls[0][0];
    expect(options.hostname).toBe('api.tavily.com');
  });

  it('uses brave when WEB_SEARCH_PROVIDER=brave', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'brave';
    responseQueue.push({ statusCode: 200, body: braveBody([]) });

    await webSearch('q');

    const options = mockHttpsRequest.mock.calls[0][0];
    expect(options.hostname).toBe('api.search.brave.com');
  });

  it('reads each provider key from its own SSM parameter', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'tavily';
    responseQueue.push({ statusCode: 200, body: tavilyBody([]) });
    await webSearch('q');
    expect(mockSsmSend.mock.calls[0][0].params.Name).toBe('/auto-rfp/tavily/api-key');

    process.env.WEB_SEARCH_PROVIDER = 'brave';
    responseQueue.push({ statusCode: 200, body: braveBody([]) });
    await webSearch('q');
    expect(mockSsmSend.mock.calls[1][0].params.Name).toBe('/auto-rfp/brave-search/api-key');
  });

  it('throws on an unknown provider without calling SSM or the network', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'bing';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(webSearch('q')).rejects.toThrow('Unknown web search provider "bing"');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown WEB_SEARCH_PROVIDER "bing"'));
    expect(mockSsmSend).not.toHaveBeenCalled();
    expect(mockHttpsRequest).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('webSearch (brave provider)', () => {
  beforeEach(() => {
    process.env.WEB_SEARCH_PROVIDER = 'brave';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: 'test-brave-key' } });
  });

  it('returns normalized {title, url, snippet} results', async () => {
    responseQueue.push({
      statusCode: 200,
      body: braveBody([
        { title: 'Datadog Pricing', url: 'https://datadoghq.com/pricing', description: '$23 per host' },
        { title: 'Review', url: 'https://example.com', description: 'a review' },
      ]),
    });

    const results = await webSearch('Datadog pricing');

    expect(results).toEqual([
      { title: 'Datadog Pricing', url: 'https://datadoghq.com/pricing', snippet: '$23 per host' },
      { title: 'Review', url: 'https://example.com', snippet: 'a review' },
    ]);
  });

  it('sends the query, count, and subscription token header', async () => {
    responseQueue.push({ statusCode: 200, body: braveBody([]) });

    await webSearch('GitHub Enterprise pricing', { count: 3 });

    const options = mockHttpsRequest.mock.calls[0][0];
    expect(options.hostname).toBe('api.search.brave.com');
    expect(options.path).toContain('/res/v1/web/search?');
    expect(options.path).toContain('q=GitHub+Enterprise+pricing');
    expect(options.path).toContain('count=3');
    expect(options.headers['X-Subscription-Token']).toBe('test-brave-key');
  });

  it('caps results at the requested count', async () => {
    responseQueue.push({
      statusCode: 200,
      body: braveBody([
        { title: 'a', url: 'https://a', description: '' },
        { title: 'b', url: 'https://b', description: '' },
        { title: 'c', url: 'https://c', description: '' },
      ]),
    });

    const results = await webSearch('q', { count: 2 });
    expect(results).toHaveLength(2);
  });

  it('drops results without a url and fills missing fields with empty strings', async () => {
    responseQueue.push({
      statusCode: 200,
      body: braveBody([{ description: 'no url' }, { url: 'https://a' }]),
    });

    const results = await webSearch('q');
    expect(results).toEqual([{ title: '', url: 'https://a', snippet: '' }]);
  });

  it('returns [] when the response has no web results', async () => {
    responseQueue.push({ statusCode: 200, body: JSON.stringify({}) });
    await expect(webSearch('q')).resolves.toEqual([]);
  });

  it('caches the API key across calls (one SSM call for two searches)', async () => {
    responseQueue.push({ statusCode: 200, body: braveBody([]) });
    responseQueue.push({ statusCode: 200, body: braveBody([]) });

    await webSearch('one');
    await webSearch('two');

    expect(mockSsmSend).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429 and succeeds', async () => {
    responseQueue.push({ statusCode: 429, body: 'rate limited' });
    responseQueue.push({
      statusCode: 200,
      body: braveBody([{ title: 't', url: 'https://a', description: 's' }]),
    });

    const results = await webSearch('q');

    expect(results).toHaveLength(1);
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
  }, 10000);

  it('throws when the retry is also rate limited', async () => {
    responseQueue.push({ statusCode: 429, body: 'rate limited' });
    responseQueue.push({ statusCode: 429, body: 'rate limited' });

    await expect(webSearch('q')).rejects.toThrow('429');
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
  }, 10000);

  it('does not retry on non-429 errors', async () => {
    responseQueue.push({ statusCode: 500, body: 'server error' });

    await expect(webSearch('q')).rejects.toThrow('500');
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
  });

  it('throws when the API key is unavailable', async () => {
    mockSsmSend.mockRejectedValue(new Error('ssm down'));

    await expect(webSearch('q')).rejects.toThrow('brave web search API key not found');
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });
});

describe('webSearch (tavily provider)', () => {
  beforeEach(() => {
    process.env.WEB_SEARCH_PROVIDER = 'tavily';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: 'test-tavily-key' } });
  });

  it('returns normalized {title, url, snippet} results (content → snippet)', async () => {
    responseQueue.push({
      statusCode: 200,
      body: tavilyBody([
        { title: 'Datadog Pricing', url: 'https://datadoghq.com/pricing', content: '$23 per host' },
        { title: 'Review', url: 'https://example.com', content: 'a review' },
      ]),
    });

    const results = await webSearch('Datadog pricing');

    expect(results).toEqual([
      { title: 'Datadog Pricing', url: 'https://datadoghq.com/pricing', snippet: '$23 per host' },
      { title: 'Review', url: 'https://example.com', snippet: 'a review' },
    ]);
  });

  it('POSTs {query, max_results} with a Bearer token', async () => {
    responseQueue.push({ statusCode: 200, body: tavilyBody([]) });

    await webSearch('GitHub Enterprise pricing', { count: 3 });

    const options = mockHttpsRequest.mock.calls[0][0];
    expect(options.hostname).toBe('api.tavily.com');
    expect(options.path).toBe('/search');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-tavily-key');
    expect(JSON.parse(writtenBodies[0])).toEqual({ query: 'GitHub Enterprise pricing', max_results: 3 });
  });

  it('caps results at the requested count', async () => {
    responseQueue.push({
      statusCode: 200,
      body: tavilyBody([
        { title: 'a', url: 'https://a', content: '' },
        { title: 'b', url: 'https://b', content: '' },
        { title: 'c', url: 'https://c', content: '' },
      ]),
    });

    const results = await webSearch('q', { count: 2 });
    expect(results).toHaveLength(2);
  });

  it('drops results without a url and fills missing fields with empty strings', async () => {
    responseQueue.push({
      statusCode: 200,
      body: tavilyBody([{ content: 'no url' }, { url: 'https://a' }]),
    });

    const results = await webSearch('q');
    expect(results).toEqual([{ title: '', url: 'https://a', snippet: '' }]);
  });

  it('returns [] when the response has no results', async () => {
    responseQueue.push({ statusCode: 200, body: JSON.stringify({}) });
    await expect(webSearch('q')).resolves.toEqual([]);
  });

  it('retries once on 429 and succeeds', async () => {
    responseQueue.push({ statusCode: 429, body: 'rate limited' });
    responseQueue.push({
      statusCode: 200,
      body: tavilyBody([{ title: 't', url: 'https://a', content: 's' }]),
    });

    const results = await webSearch('q');

    expect(results).toHaveLength(1);
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
  }, 10000);

  it('throws when the retry is also rate limited', async () => {
    responseQueue.push({ statusCode: 429, body: 'rate limited' });
    responseQueue.push({ statusCode: 429, body: 'rate limited' });

    await expect(webSearch('q')).rejects.toThrow('429');
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
  }, 10000);

  it('does not retry on non-429 errors', async () => {
    responseQueue.push({ statusCode: 500, body: 'server error' });

    await expect(webSearch('q')).rejects.toThrow('500');
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
  });

  it('throws when the API key is unavailable', async () => {
    mockSsmSend.mockRejectedValue(new Error('ssm down'));

    await expect(webSearch('q')).rejects.toThrow('tavily web search API key not found');
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('caches keys per provider (separate SSM call per provider, then cached)', async () => {
    responseQueue.push({ statusCode: 200, body: tavilyBody([]) });
    await webSearch('one');

    process.env.WEB_SEARCH_PROVIDER = 'brave';
    responseQueue.push({ statusCode: 200, body: braveBody([]) });
    await webSearch('two');

    process.env.WEB_SEARCH_PROVIDER = 'tavily';
    responseQueue.push({ statusCode: 200, body: tavilyBody([]) });
    await webSearch('three');

    expect(mockSsmSend).toHaveBeenCalledTimes(2);
  });
});
