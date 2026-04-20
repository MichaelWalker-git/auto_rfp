/**
 * HigherGov API client.
 *
 * REST API v1.2 — https://www.highergov.com/api-external/docs/
 * Auth: api_key query parameter
 * Rate limit: 10 req/s, 100K req/day, 10K records/month
 */
import https from 'https';
import type { HigherGovOpportunitySlim } from '@auto-rfp/core';

export type HigherGovConfig = {
  baseUrl: string;
  apiKey: string;
  httpsAgent?: https.Agent;
};

export type HigherGovAttachment = {
  url: string;
  name?: string;
  mimeType?: string;
  /** Pre-extracted text content from HigherGov (avoids needing OCR) */
  textExtract?: string;
  /** HigherGov-generated document summary */
  summary?: string;
};

// ─── HTTP helper ─────────────────────────────────────────────────────────────

const httpsGetJson = async (url: URL, agent?: https.Agent): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HigherGov API ${res.statusCode}: ${body.substring(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON from HigherGov'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
};

// ─── Search opportunities ────────────────────────────────────────────────────

/**
 * Search HigherGov opportunities.
 *
 * NOTE: The HigherGov API does NOT support free-text keyword search as a query
 * parameter. Supported API filters are: source_type, agency_key, posted_date,
 * and search_id (a saved search created in the HigherGov UI).
 *
 * When `keywords` is provided, we fetch a larger page from the API and filter
 * results client-side by matching against title, description, and agency name.
 */
export const searchHigherGovOpportunities = async (
  cfg: HigherGovConfig,
  params: {
    keywords?: string;
    agencyKey?: string;
    sourceType?: string;
    postedDate?: string;
    ordering?: string;
    pageNumber?: number;
    pageSize?: number;
  },
): Promise<{ results: HigherGovOpportunitySlim[]; totalCount: number; pages: number }> => {
  const url = new URL('/api-external/opportunity/', cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);

  if (params.agencyKey)  url.searchParams.set('agency_key', params.agencyKey);
  if (params.sourceType) url.searchParams.set('source_type', params.sourceType);
  if (params.postedDate) url.searchParams.set('posted_date', params.postedDate);
  url.searchParams.set('ordering', params.ordering ?? '-captured_date');

  // When filtering by keywords client-side, fetch more results to compensate for filtering
  const requestedSize = Math.min(params.pageSize ?? 25, 100);
  const fetchSize = params.keywords ? 100 : requestedSize;
  url.searchParams.set('page_number', String(params.pageNumber ?? 1));
  url.searchParams.set('page_size', String(fetchSize));

  const json = (await httpsGetJson(url, cfg.httpsAgent)) as Record<string, unknown>;
  let results = (Array.isArray(json.results) ? json.results : []) as HigherGovOpportunitySlim[];
  const meta = json.meta as Record<string, unknown> | undefined;
  const pagination = meta?.pagination as Record<string, number> | undefined;

  // Client-side keyword filtering (API doesn't support free-text search)
  if (params.keywords) {
    const terms = params.keywords.toLowerCase().split(/\s+/).filter(Boolean);
    results = results.filter((opp) => {
      const searchable = [
        opp.title,
        opp.description_text,
        opp.ai_summary,
        opp.agency?.name,
        opp.agency?.abbreviation,
        opp.naics_code?.description,
        opp.psc_code?.description,
        opp.product_service,
        opp.source_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
  }

  return {
    results: results.slice(0, requestedSize),
    totalCount: params.keywords ? results.length : (pagination?.count ?? results.length),
    pages: params.keywords ? 1 : (pagination?.pages ?? 1),
  };
};

// ─── Fetch single opportunity ────────────────────────────────────────────────

export const fetchHigherGovOpportunity = async (
  cfg: HigherGovConfig,
  oppKey: string,
): Promise<HigherGovOpportunitySlim> => {
  const url = new URL('/api-external/opportunity/', cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);
  url.searchParams.set('opp_key', oppKey);
  url.searchParams.set('page_size', '1');

  const json = (await httpsGetJson(url, cfg.httpsAgent)) as Record<string, unknown>;
  const results = Array.isArray(json.results) ? json.results : [];
  if (results.length === 0) throw new Error(`HigherGov opportunity not found: ${oppKey}`);
  return results[0] as HigherGovOpportunitySlim;
};

// ─── Fetch documents ─────────────────────────────────────────────────────────

/**
 * Extract the related_key from a HigherGov document_path field.
 * document_path can be:
 *   - A full URL: "/api-external/document/?related_key=ABC123"
 *   - Just the key: "ABC123"
 *   - undefined/null
 */
const extractRelatedKey = (documentPath?: string | null, fallbackOppKey?: string): string | null => {
  if (!documentPath && !fallbackOppKey) return null;
  if (!documentPath) return fallbackOppKey ?? null;

  // Try to extract related_key from URL-like path
  const match = /related_key=([^&]+)/.exec(documentPath);
  if (match) return match[1];

  // Might be just the key itself
  return documentPath;
};

/**
 * Fetch document download URLs for an opportunity.
 * Download URLs expire after 60 minutes — must download immediately.
 *
 * HigherGov Document API returns: download_url, file_name, file_type,
 * file_size, posted_date, text_extract, summary.
 *
 * The `related_key` parameter value comes from the opportunity's `document_path` field.
 */
export const fetchHigherGovDocuments = async (
  cfg: HigherGovConfig,
  documentPath: string | undefined | null,
  fallbackOppKey?: string,
): Promise<HigherGovAttachment[]> => {
  const relatedKey = extractRelatedKey(documentPath, fallbackOppKey);
  if (!relatedKey) {
    console.log('[HigherGov] No document_path or opp_key — skipping document fetch');
    return [];
  }

  const allDocs: HigherGovAttachment[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = new URL('/api-external/document/', cfg.baseUrl);
    url.searchParams.set('api_key', cfg.apiKey);
    url.searchParams.set('related_key', relatedKey);
    url.searchParams.set('page_number', String(page));
    url.searchParams.set('page_size', '100');

    const json = (await httpsGetJson(url, cfg.httpsAgent)) as Record<string, unknown>;
    const results = Array.isArray(json.results) ? json.results : [];
    const meta = json.meta as Record<string, unknown> | undefined;
    const pagination = meta?.pagination as Record<string, number> | undefined;
    totalPages = pagination?.pages ?? 1;

    console.log(`[HigherGov] Documents page ${page}/${totalPages}: ${results.length} results for related_key=${relatedKey}`);

    for (const doc of results as Record<string, unknown>[]) {
      const downloadUrl = String(doc.download_url ?? '');
      if (!downloadUrl || !/^https?:\/\//i.test(downloadUrl)) continue;

      allDocs.push({
        url: downloadUrl,
        name: doc.file_name ? String(doc.file_name) : undefined,
        mimeType: doc.file_type ? String(doc.file_type) : undefined,
        textExtract: doc.text_extract ? String(doc.text_extract) : undefined,
        summary: doc.summary ? String(doc.summary) : undefined,
      });
    }

    page++;
  }

  return allDocs;
};