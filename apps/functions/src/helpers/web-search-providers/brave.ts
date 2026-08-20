/**
 * Brave Search API provider (`GET https://api.search.brave.com/res/v1/web/search`,
 * `X-Subscription-Token` header). Request + normalization moved as-is from the
 * original `web-search-client.ts`; the 429 retry-once lives in the client.
 */

import https from 'https';
import { z } from 'zod';
import type { WebSearchProvider, WebSearchResult } from './types';

const BRAVE_SEARCH_HOSTNAME = 'api.search.brave.com';
const BRAVE_SEARCH_PATH = '/res/v1/web/search';

/** Shape of the Brave Search API response — only what we read. */
const BraveSearchResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z
            .object({
              title: z.string().optional(),
              url: z.string().optional(),
              description: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .optional(),
});

/** One HTTPS GET against the Brave Search API. */
const braveSearchRequest = (query: string, count: number, apiKey: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const params = new URLSearchParams({ q: query, count: String(count) });
    const options = {
      hostname: BRAVE_SEARCH_HOSTNAME,
      port: 443,
      path: `${BRAVE_SEARCH_PATH}?${params.toString()}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'X-Subscription-Token': apiKey,
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          const statusCode = res.statusCode ?? 500;
          reject(
            Object.assign(
              new Error(`Brave Search request failed: ${statusCode} ${res.statusMessage ?? ''} - ${body}`),
              { statusCode },
            ),
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });

/** Parse a raw Brave response body into normalized results. */
const normalizeBraveResults = (body: string, count: number): WebSearchResult[] => {
  const { success, data } = BraveSearchResponseSchema.safeParse(JSON.parse(body));
  if (!success || !data.web?.results) {
    return [];
  }

  return data.web.results
    .filter((r) => Boolean(r.url))
    .slice(0, count)
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
    }));
};

export const braveProvider: WebSearchProvider = {
  name: 'brave',
  ssmParamEnvVar: 'BRAVE_SEARCH_API_KEY_SSM_PARAM',
  defaultSsmParamName: '/auto-rfp/brave-search/api-key',
  search: async (query, count, apiKey) =>
    normalizeBraveResults(await braveSearchRequest(query, count, apiKey), count),
};
