import https from 'https';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import {
  searchHigherGovOpportunities,
  fetchHigherGovOpportunity,
  fetchHigherGovDocuments,
  type HigherGovConfig,
} from './highergov';

// ─── Mock https.get ──────────────────────────────────────────────────────────

const mockGet = jest.spyOn(https, 'get');

const fakeResponse = (statusCode: number, body: unknown) => {
  const res = new IncomingMessage(new Socket());
  res.statusCode = statusCode;
  setTimeout(() => {
    res.emit('data', Buffer.from(JSON.stringify(body)));
    res.emit('end');
  }, 0);
  return res;
};

const cfg: HigherGovConfig = { baseUrl: 'https://www.highergov.com/api-external', apiKey: 'test-key' };

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── searchHigherGovOpportunities ────────────────────────────────────────────

describe('searchHigherGovOpportunities', () => {
  it('returns results and pagination from API response', async () => {
    const apiResp = {
      results: [
        { opp_key: 'OPP-1', title: 'Test Opp', source_id: 'N123', posted_date: '2025-01-01' },
      ],
      meta: { pagination: { page: 1, pages: 3, count: 42 } },
    };

    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, apiResp));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    const result = await searchHigherGovOpportunities(cfg, { pageSize: 25 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].opp_key).toBe('OPP-1');
    expect(result.totalCount).toBe(42);
    expect(result.pages).toBe(3);
  });

  it('filters by keywords client-side (API has no keyword search)', async () => {
    const apiResp = {
      results: [
        { opp_key: 'OPP-1', title: 'Cybersecurity Assessment', ai_summary: 'Pen testing services' },
        { opp_key: 'OPP-2', title: 'Office Supplies', ai_summary: 'Paper and pens' },
        { opp_key: 'OPP-3', title: 'Network Cyber Defense', description_text: 'SOC operations' },
      ],
      meta: { pagination: { page: 1, pages: 1, count: 3 } },
    };

    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, apiResp));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    const result = await searchHigherGovOpportunities(cfg, { keywords: 'cyber', pageSize: 25 });

    // Only OPP-1 and OPP-3 match "cyber"
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.opp_key)).toEqual(['OPP-1', 'OPP-3']);
    expect(result.totalCount).toBe(2); // client-side count
  });

  it('passes supported API parameters correctly (no keyword param sent)', async () => {
    mockGet.mockImplementation((url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, { results: [], meta: { pagination: { page: 1, pages: 0, count: 0 } } }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    await searchHigherGovOpportunities(cfg, {
      keywords: 'cyber',
      sourceType: 'sbir',
      postedDate: '2025-06-01',
      pageNumber: 2,
      pageSize: 50,
    });

    const calledUrl = mockGet.mock.calls[0]![0] as URL;
    // keywords should NOT be sent as API param (API doesn't support it)
    expect(calledUrl.searchParams.has('q')).toBe(false);
    expect(calledUrl.searchParams.has('keywords')).toBe(false);
    expect(calledUrl.searchParams.get('source_type')).toBe('sbir');
    expect(calledUrl.searchParams.get('posted_date')).toBe('2025-06-01');
    expect(calledUrl.searchParams.get('page_number')).toBe('2');
    // When keywords present, fetches 100 for client-side filtering
    expect(calledUrl.searchParams.get('page_size')).toBe('100');
    expect(calledUrl.searchParams.get('api_key')).toBe('test-key');
  });

  it('throws on API error', async () => {
    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(403, { error: 'Forbidden' }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    await expect(searchHigherGovOpportunities(cfg, {})).rejects.toThrow('HigherGov API 403');
  });

  it('caps page_size at 100', async () => {
    mockGet.mockImplementation((url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, { results: [], meta: { pagination: { page: 1, pages: 0, count: 0 } } }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    await searchHigherGovOpportunities(cfg, { pageSize: 500 });

    const calledUrl = mockGet.mock.calls[0]![0] as URL;
    expect(calledUrl.searchParams.get('page_size')).toBe('100');
  });
});

// ─── fetchHigherGovOpportunity ───────────────────────────────────────────────

describe('fetchHigherGovOpportunity', () => {
  it('returns the first result', async () => {
    const opp = { opp_key: 'OPP-99', title: 'Found It' };
    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, { results: [opp] }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    const result = await fetchHigherGovOpportunity(cfg, 'OPP-99');
    expect(result.opp_key).toBe('OPP-99');
    expect(result.title).toBe('Found It');
  });

  it('throws when no results', async () => {
    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, { results: [] }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    await expect(fetchHigherGovOpportunity(cfg, 'MISSING')).rejects.toThrow('not found');
  });
});

// ─── fetchHigherGovDocuments ─────────────────────────────────────────────────

describe('fetchHigherGovDocuments', () => {
  it('returns attachments with valid URLs and correct field mapping', async () => {
    const docs = {
      results: [
        { download_url: 'https://cdn.example.com/doc.pdf', file_name: 'RFP.pdf', file_type: 'application/pdf', text_extract: 'some text', summary: 'doc summary' },
        { download_url: '', file_name: 'empty.pdf' },
        { download_url: 'ftp://bad.com/file', file_name: 'bad.pdf' },
      ],
      meta: { pagination: { page: 1, pages: 1, count: 3 } },
    };
    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, docs));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    const result = await fetchHigherGovDocuments(cfg, '/api-external/document/?related_key=DOC-KEY', 'OPP-1');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://cdn.example.com/doc.pdf');
    expect(result[0].name).toBe('RFP.pdf');
    expect(result[0].mimeType).toBe('application/pdf');
    expect(result[0].textExtract).toBe('some text');
    expect(result[0].summary).toBe('doc summary');

    // Verify related_key was extracted from document_path
    const calledUrl = mockGet.mock.calls[0]![0] as URL;
    expect(calledUrl.searchParams.get('related_key')).toBe('DOC-KEY');
  });

  it('falls back to opp_key when document_path is null', async () => {
    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, { results: [], meta: { pagination: { page: 1, pages: 1, count: 0 } } }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    await fetchHigherGovDocuments(cfg, null, 'OPP-FALLBACK');
    const calledUrl = mockGet.mock.calls[0]![0] as URL;
    expect(calledUrl.searchParams.get('related_key')).toBe('OPP-FALLBACK');
  });

  it('returns empty array when both document_path and opp_key are null', async () => {
    const result = await fetchHigherGovDocuments(cfg, null, undefined);
    expect(result).toHaveLength(0);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns empty array when no results', async () => {
    mockGet.mockImplementation((_url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      (callback as (res: IncomingMessage) => void)(fakeResponse(200, { results: [], meta: { pagination: { page: 1, pages: 1, count: 0 } } }));
      return { on: jest.fn(), end: jest.fn() } as unknown as ReturnType<typeof https.get>;
    });

    const result = await fetchHigherGovDocuments(cfg, 'some-key');
    expect(result).toHaveLength(0);
  });
});