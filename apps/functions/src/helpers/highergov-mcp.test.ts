/**
 * Tests for the HigherGov MCP client.
 *
 * The search fixture in `__fixtures__/highergov-mcp-search.json` is a REAL captured
 * response (trimmed to 2 records), not a hand-written approximation — the envelope is the
 * thing most likely to drift, so the tests assert against what the server actually sent.
 */
import fs from 'fs';
import path from 'path';

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

const mockRequest = jest.fn();
jest.mock('https', () => ({
  __esModule: true,
  default: { request: (...args: unknown[]) => mockRequest(...args), Agent: jest.fn() },
  request: (...args: unknown[]) => mockRequest(...args),
  Agent: jest.fn(),
}));

import {
  searchHigherGovViaMcp,
  parseMcpEnvelope,
  extractFencedJson,
  HIGHERGOV_MCP_URL,
} from './highergov-mcp';

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'highergov-mcp-search.json'),
  'utf-8',
);

/** Drive the mocked https.request through one response body. */
const respondWith = (body: string, statusCode = 200) => {
  mockRequest.mockImplementation((_opts: unknown, cb: (res: unknown) => void) => {
    const res = {
      statusCode,
      statusMessage: statusCode === 200 ? 'OK' : 'Error',
      on: (ev: string, fn: (arg?: unknown) => void) => {
        if (ev === 'data') fn(Buffer.from(body));
        if (ev === 'end') fn();
        return res;
      },
    };
    cb(res);
    return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
  });
};

/** The JSON body our client POSTed, for asserting on the wire format. */
const sentBody = (): Record<string, unknown> => {
  const write = (mockRequest.mock.results[0]?.value as { write: jest.Mock }).write;
  return JSON.parse(write.mock.calls[0][0] as string) as Record<string, unknown>;
};

const cfg = { baseUrl: '', apiKey: 'test-key-123' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequest.mockReset();
});

describe('parseMcpEnvelope', () => {
  it('parses a plain JSON reply', () => {
    expect(parseMcpEnvelope('{"jsonrpc":"2.0","id":1,"result":{}}').result).toEqual({});
  });

  it('strips SSE `data: ` framing', () => {
    // Streamable-HTTP servers may answer a POST with text/event-stream.
    const env = parseMcpEnvelope('data: {"jsonrpc":"2.0","id":1,"result":{"isError":true}}\n');
    expect(env.result?.isError).toBe(true);
  });

  it('rejects an empty body rather than returning a hollow result', () => {
    expect(() => parseMcpEnvelope('   ')).toThrow(/empty response/i);
  });

  it('rejects an unparseable body', () => {
    expect(() => parseMcpEnvelope('<html>gateway timeout</html>')).toThrow(/unparseable/i);
  });
});

describe('extractFencedJson', () => {
  it('pulls the payload out from behind the human summary line', () => {
    const text = 'Returned 1 records. 1 total matching records. page 1 of 1.\n\n```json\n{"results":[]}\n```';
    expect(extractFencedJson(text)).toEqual({ results: [] });
  });

  it('throws when the fence is missing, so a contract change is visible', () => {
    // Returning [] here would silently look like "no matching opportunities".
    expect(() => extractFencedJson('Returned 0 records.')).toThrow(/no JSON block/i);
  });
});

describe('searchHigherGovViaMcp — wire format', () => {
  it('calls the search_opportunities tool over JSON-RPC at the MCP endpoint', async () => {
    respondWith(FIXTURE);
    await searchHigherGovViaMcp(cfg, { keyword: 'zero trust' });

    const body = sentBody();
    expect(body.method).toBe('tools/call');
    expect((body.params as { name: string }).name).toBe('search_opportunities');

    const [opts] = mockRequest.mock.calls[0] as [{ hostname: string; path: string; headers: Record<string, string> }];
    expect(`https://${opts.hostname}${opts.path}`).toBe(HIGHERGOV_MCP_URL);
    expect(opts.headers.Authorization).toBe('Bearer test-key-123');
    expect(opts.headers.Accept).toContain('text/event-stream');
  });

  it('passes the query string through VERBATIM, preserving every operator', async () => {
    // Sanitising this would break HigherGov's documented query language — quoting alone is
    // the difference between 40 and 1593 results for "Document Management".
    respondWith(FIXTURE);
    const q = '("data dashboard" or "data center") -Subscription -License';
    await searchHigherGovViaMcp(cfg, { keyword: q });

    const args = (sentBody().params as { arguments: Record<string, unknown> }).arguments;
    expect(args.keyword).toBe(q);
  });

  it('maps params to the tool\'s snake_case names', async () => {
    respondWith(FIXTURE);
    await searchHigherGovViaMcp(cfg, {
      keyword: 'saas',
      naicsCode: '541512',
      opportunityType: 'state_local',
      activeOnly: true,
      postedDate: '2026-08-01',
      pageNumber: 3,
    });

    const args = (sentBody().params as { arguments: Record<string, unknown> }).arguments;
    expect(args).toEqual({
      keyword: 'saas',
      naics_code: '541512',
      opportunity_type: 'state_local',
      active_opportunity: true,
      posted_date: '2026-08-01',
      page_number: 3,
    });
  });

  it('omits unset params so the tool applies its own defaults', async () => {
    respondWith(FIXTURE);
    await searchHigherGovViaMcp(cfg, { keyword: 'saas' });

    const args = (sentBody().params as { arguments: Record<string, unknown> }).arguments;
    expect(Object.keys(args)).toEqual(['keyword']);
  });

  it('sends activeOnly=false explicitly, since it is meaningful', async () => {
    // false is not "unset": it switches a saas search from 18 results to 2860.
    respondWith(FIXTURE);
    await searchHigherGovViaMcp(cfg, { keyword: 'saas', activeOnly: false });

    const args = (sentBody().params as { arguments: Record<string, unknown> }).arguments;
    expect(args.active_opportunity).toBe(false);
  });
});

describe('searchHigherGovViaMcp — response handling', () => {
  it('parses real captured output into validated records', async () => {
    respondWith(FIXTURE);
    const { results, totalCount, pages } = await searchHigherGovViaMcp(cfg, { keyword: 'zero trust' });

    expect(results).toHaveLength(2);
    expect(totalCount).toBe(7); // from meta.pagination.count, not the row count
    expect(pages).toBe(1);
    expect(results[0]?.opp_key).toBeTruthy();
    expect(results[0]?.title).toBeTruthy();
  });

  it('surfaces a tool-level isError with its message', async () => {
    // How an unknown search_id arrives — the message drives the UI's specific wording.
    respondWith(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'SearchFull matching query does not exist.' }] },
    }));

    await expect(searchHigherGovViaMcp(cfg, { searchId: 'nope' }))
      .rejects.toThrow(/does not exist/i);
  });

  it('surfaces a JSON-RPC transport error', async () => {
    respondWith(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'invalid params' } }));
    await expect(searchHigherGovViaMcp(cfg, { keyword: 'x' })).rejects.toThrow(/invalid params/i);
  });

  it('throws on a non-2xx without echoing the (potentially huge) body', async () => {
    respondWith('server exploded', 503);
    await expect(searchHigherGovViaMcp(cfg, { keyword: 'x' })).rejects.toThrow(/503/);
    await expect(searchHigherGovViaMcp(cfg, { keyword: 'x' })).rejects.not.toThrow(/exploded/);
  });

  it('drops rows that fail schema validation instead of passing them downstream', async () => {
    // MCP is unversioned; a shape change must degrade gracefully, not corrupt results.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    respondWith(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text:
        'Returned 2 records. 2 total matching records. page 1 of 1.\n\n```json\n' +
        JSON.stringify({ results: [{ opp_key: 'ok-1', title: 'Valid row' }, { opp_key: 12345 }],
                         meta: { pagination: { count: 2, pages: 1 } } }) +
        '\n```' }] },
    }));

    const { results } = await searchHigherGovViaMcp(cfg, { keyword: 'x' });
    expect(results).toHaveLength(1);
    expect(results[0]?.opp_key).toBe('ok-1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropped 1/2'));
    warn.mockRestore();
  });

  it('falls back to the row count when pagination metadata is absent', async () => {
    respondWith(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text:
        'Returned 1 records.\n\n```json\n' + JSON.stringify({ results: [{ opp_key: 'a', title: 'T' }] }) + '\n```' }] },
    }));

    const { totalCount, pages } = await searchHigherGovViaMcp(cfg, { keyword: 'x' });
    expect(totalCount).toBe(1);
    expect(pages).toBe(1);
  });

  it('throws when the reply carries no content block', async () => {
    respondWith(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    await expect(searchHigherGovViaMcp(cfg, { keyword: 'x' })).rejects.toThrow(/no content/i);
  });
});
