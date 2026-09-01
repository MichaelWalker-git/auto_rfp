/**
 * HigherGov MCP client.
 *
 * Endpoint: https://www.highergov.com/mcp/ — docs at
 * https://docs.highergov.com/import-and-export/highergov-mcp
 *
 * WHY THIS EXISTS ALONGSIDE `highergov.ts`
 *
 * HigherGov's REST API (`/api-external/opportunity/`) accepts only 11 params and has NO
 * keyword/NAICS/set-aside filter — passing `keywords` is silently ignored (a baseline
 * `posted_date` query and the same query plus `keywords=zzzznonsense` both return 580
 * results). Their MCP server exposes the same data through `search_opportunities`, which
 * DOES accept `keyword` and `naics_code`, and honours HigherGov's full documented query
 * language: implicit AND, `or`, `"close match"` phrases, `-exclude`, and `( )` grouping
 * (https://docs.highergov.com/highergov-basics/search-basics).
 *
 * Records come back in the same shape as REST, so `HigherGovOpportunitySearchResultSchema`
 * and `higherGovToSearchOpportunity` are reused unchanged.
 *
 * Caveats this module is built around:
 * - MCP is absent from their OpenAPI spec and their docs warn support "is changing
 *   quickly", so the payload contract is treated as unversioned: every row is validated
 *   and non-conforming rows are dropped rather than trusted.
 * - The tool returns a HUMAN-ORIENTED text blob, not JSON: a summary line followed by a
 *   fenced ```json block. Responses may also be SSE-framed (`data: ` prefixed lines).
 * - Page size is capped at 100 and is a ceiling rather than a charge — a 3-result search
 *   reports "Returned 3 records" — so precise queries cost little of the 10K/month quota.
 */
import https from 'https';
import {
  HigherGovOpportunitySearchResultSchema,
  type HigherGovOpportunitySearchResult,
} from '@auto-rfp/core';

import type { HigherGovConfig } from './highergov';

/** Which market(s) to search. Mirrors the tool's `opportunity_type` enum exactly. */
export type HigherGovMarket =
  | 'federal_contract'
  | 'state_local'
  | 'federal_and_state_local'
  | 'federal_grant'
  | 'dibbs'
  | 'sbir'
  | 'federal_forecast'
  | 'sled_forecast'
  | 'all';

export type HigherGovMcpSearchParams = {
  /**
   * Free-text query, passed to HigherGov VERBATIM.
   *
   * Never sanitise this: stripping quotes, `-` or `or` would break the query language
   * users already rely on. `"Document Management"` returns 40 where the unquoted form
   * returns 1593.
   */
  keyword?: string;
  naicsCode?: string;
  /** A saved search built in HigherGov's UI. Can carry filters `keyword` cannot express. */
  searchId?: string;
  opportunityType?: HigherGovMarket;
  /**
   * Restrict to currently open opportunities. The highest-impact filter here: the same
   * query returns 18 active vs 2860 all-time.
   */
  activeOnly?: boolean;
  /** Single day, `YYYY-MM-DD`. The tool has no date-range parameter. */
  postedDate?: string;
  pageNumber?: number;
};

export const HIGHERGOV_MCP_URL = 'https://www.highergov.com/mcp/';

/** Max rows the tool will return per call; not configurable. */
export const HIGHERGOV_MCP_PAGE_SIZE = 100;

// ─── Transport ───────────────────────────────────────────────────────────────

const postJsonRpc = async (
  cfg: HigherGovConfig,
  body: string,
  url: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: target.hostname,
        path: target.pathname + target.search,
        agent: cfg.httpsAgent,
        headers: {
          // Bearer is the documented preferred scheme; the key never goes in the URL.
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          // The server may reply as either plain JSON or an SSE stream.
          Accept: 'application/json, text/event-stream',
          'Content-Length': String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 400) {
            // Deliberately not echoing the body: it can be ~1.7MB and may quote the request.
            reject(new Error(`HigherGov MCP ${res.statusCode} ${res.statusMessage ?? ''}`.trim()));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

// ─── Envelope parsing ────────────────────────────────────────────────────────

type McpToolResult = {
  result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  error?: { message?: string };
};

/**
 * Unwrap a JSON-RPC reply that may arrive SSE-framed.
 *
 * Streamable-HTTP servers are allowed to answer a POST with `text/event-stream`, in which
 * case each line is `data: {...}`. A stream can carry MULTIPLE events — e.g. one or more
 * `notifications/progress` events before the final tool result — so every `data:` line must
 * be parsed as its OWN JSON document, not concatenated with the others and scanned for the
 * last `{`. That naive approach breaks as soon as any earlier or later event's payload
 * contains a `{` of its own (which the final event's `text` field always does, since it's a
 * human summary line followed by a fenced JSON block): the "last brace" is then somewhere
 * inside that nested text, not the start of the envelope, and parsing fails on a perfectly
 * valid response. Parsing each event independently and keeping the last one that is a real
 * JSON-RPC response (has `result` or `error`, unlike a notification) is correct regardless
 * of how many events precede it.
 */
export const parseMcpEnvelope = (raw: string): McpToolResult => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty response from HigherGov MCP');

  const dataLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(line.indexOf(':') + 1).trim())
    .filter(Boolean);

  // Not SSE-framed at all: treat the whole body as one JSON document.
  const candidates = dataLines.length ? dataLines : [trimmed];

  let response: McpToolResult | undefined;
  for (const candidate of candidates) {
    let parsed: McpToolResult;
    try {
      parsed = JSON.parse(candidate) as McpToolResult;
    } catch {
      continue; // not a standalone JSON event — ignore and keep scanning
    }
    // JSON-RPC notifications (e.g. notifications/progress) have neither `result` nor
    // `error`; skip them so the real response wins even when it isn't the final event.
    if ('result' in parsed || 'error' in parsed) response = parsed;
  }

  if (response) return response;
  throw new Error('Unparseable response from HigherGov MCP');
};

/**
 * Pull the fenced JSON payload out of the tool's text block.
 *
 * The text is a human summary line ("Returned 7 records. 7 total matching records.")
 * followed by a ```json fence. Throws rather than returning empty on a missing fence, so a
 * contract change surfaces as a visible failure instead of a silently empty result set.
 */
export const extractFencedJson = (text: string): unknown => {
  const fence = /```json\s*([\s\S]*?)\s*```/.exec(text);
  if (!fence?.[1]) {
    throw new Error('HigherGov MCP response contained no JSON block');
  }
  return JSON.parse(fence[1]);
};

type McpSearchPayload = {
  results?: unknown[];
  meta?: { pagination?: { count?: number; pages?: number; page?: number } };
};

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Search HigherGov opportunities through the MCP `search_opportunities` tool.
 *
 * Returns the same shape as `searchHigherGovOpportunities` so callers can swap between
 * transports without remapping.
 */
export const searchHigherGovViaMcp = async (
  cfg: HigherGovConfig,
  params: HigherGovMcpSearchParams,
): Promise<{ results: HigherGovOpportunitySearchResult[]; totalCount: number; pages: number }> => {
  // Only send what the caller set: the tool defaults `opportunity_type` to
  // federal_contract, and an explicit null/undefined would be rejected.
  const args: Record<string, string | number | boolean> = {};
  if (params.keyword?.trim()) args.keyword = params.keyword.trim();
  if (params.naicsCode) args.naics_code = params.naicsCode;
  if (params.searchId) args.search_id = params.searchId;
  if (params.opportunityType) args.opportunity_type = params.opportunityType;
  if (params.activeOnly !== undefined) args.active_opportunity = params.activeOnly;
  if (params.postedDate) args.posted_date = params.postedDate;
  if (params.pageNumber && params.pageNumber > 1) args.page_number = params.pageNumber;

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'search_opportunities', arguments: args },
  });

  const envelope = parseMcpEnvelope(await postJsonRpc(cfg, body, HIGHERGOV_MCP_URL));

  if (envelope.error?.message) {
    throw new Error(`HigherGov MCP error: ${envelope.error.message}`);
  }

  const text = envelope.result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('HigherGov MCP returned no content');
  }

  // Tool-level failures (e.g. an unknown search_id -> "SearchFull matching query does not
  // exist.") arrive as a successful JSON-RPC reply with isError set. Surface the message so
  // the UI can say something specific rather than "no results".
  if (envelope.result?.isError) {
    throw new Error(text.trim() || 'HigherGov MCP request failed');
  }

  const payload = extractFencedJson(text) as McpSearchPayload;
  const rawRows = Array.isArray(payload.results) ? payload.results : [];

  // Validate every row against the shared schema. MCP is unversioned, so a shape change
  // must degrade to "fewer results plus a warning", never to malformed data downstream.
  const results: HigherGovOpportunitySearchResult[] = [];
  let rejected = 0;
  for (const row of rawRows) {
    const { success, data } = HigherGovOpportunitySearchResultSchema.safeParse(row);
    if (success) results.push(data);
    else rejected++;
  }
  if (rejected > 0) {
    console.warn(`[highergov-mcp] Dropped ${rejected}/${rawRows.length} rows failing schema validation`);
  }

  const pagination = payload.meta?.pagination;

  return {
    results,
    totalCount: pagination?.count ?? results.length,
    pages: pagination?.pages ?? 1,
  };
};
