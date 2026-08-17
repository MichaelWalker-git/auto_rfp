/**
 * Tavily Search API provider (`POST https://api.tavily.com/search`,
 * `Authorization: Bearer <key>`). Free tier: 1,000 credits/month, recurring,
 * no credit card — the primary provider since Brave dropped its free tier (T15).
 */

import https from 'https';
import { z } from 'zod';
import type { WebSearchProvider, WebSearchResult } from './types';

const TAVILY_SEARCH_HOSTNAME = 'api.tavily.com';
const TAVILY_SEARCH_PATH = '/search';

/** Shape of the Tavily Search API response — only what we read. */
const TavilySearchResponseSchema = z.object({
  results: z
    .array(
      z
        .object({
          title: z.string().optional(),
          url: z.string().optional(),
          content: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

/** One HTTPS POST against the Tavily Search API. */
const tavilySearchRequest = (query: string, count: number, apiKey: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, max_results: count });
    const options = {
      hostname: TAVILY_SEARCH_HOSTNAME,
      port: 443,
      path: TAVILY_SEARCH_PATH,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${apiKey}`,
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
              new Error(`Tavily search request failed: ${statusCode} ${res.statusMessage ?? ''} - ${body}`),
              { statusCode },
            ),
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(payload);
    req.end();
  });

/** Parse a raw Tavily response body into normalized results (content → snippet). */
const normalizeTavilyResults = (body: string, count: number): WebSearchResult[] => {
  const { success, data } = TavilySearchResponseSchema.safeParse(JSON.parse(body));
  if (!success || !data.results) {
    return [];
  }

  return data.results
    .filter((r) => Boolean(r.url))
    .slice(0, count)
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
    }));
};

export const tavilyProvider: WebSearchProvider = {
  name: 'tavily',
  ssmParamEnvVar: 'TAVILY_API_KEY_SSM_PARAM',
  defaultSsmParamName: '/auto-rfp/tavily/api-key',
  search: async (query, count, apiKey) =>
    normalizeTavilyResults(await tavilySearchRequest(query, count, apiKey), count),
};
