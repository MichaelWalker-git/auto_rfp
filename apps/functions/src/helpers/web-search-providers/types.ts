/**
 * Shared types for web-search providers (Brave, Tavily, ...).
 *
 * Providers implement one raw search request + normalization to the
 * provider-agnostic `WebSearchResult` shape; key resolution, caching,
 * provider selection, and the single 429 retry live in
 * `helpers/web-search-client.ts`.
 */

import { z } from 'zod';

/** Normalized web search result — the provider-agnostic shape. */
export const WebSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export type HttpError = Error & { statusCode?: number };

export interface WebSearchProvider {
  /** Provider id — matches the `WEB_SEARCH_PROVIDER` env var value. */
  name: string;
  /** Env var holding the SSM parameter name for this provider's API key. */
  ssmParamEnvVar: string;
  /** Fallback SSM parameter name when the env var is unset. */
  defaultSsmParamName: string;
  /**
   * One search request against the provider's API, returning normalized
   * results. Throws an `HttpError` (with `statusCode`) on non-2xx responses
   * so the client can retry once on 429.
   */
  search: (query: string, count: number, apiKey: string) => Promise<WebSearchResult[]>;
}
