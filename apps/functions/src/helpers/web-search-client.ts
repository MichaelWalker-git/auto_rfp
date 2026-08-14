/**
 * web-search-client.ts
 *
 * Provider-agnostic web search client, mirroring `bedrock-http-client.ts`:
 * the exported `webSearch(query, opts)` returns normalized results and hides
 * the provider behind it. Current implementation: Brave Search API
 * (`GET https://api.search.brave.com/res/v1/web/search`), API key from SSM
 * (`/auto-rfp/brave-search/api-key`) cached in the warm container.
 *
 * Brave's free tier allows 1 request/second — on a 429 the client retries
 * ONCE after a short delay; a second 429 (or any other failure) throws, and
 * callers (service-pricing) degrade per ADR-15 instead of failing documents.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import https from 'https';
import { z } from 'zod';
import { requireEnv } from './env';

const SSM_PARAM_NAME = requireEnv('BRAVE_SEARCH_API_KEY_SSM_PARAM', '/auto-rfp/brave-search/api-key');
const REGION = requireEnv('REGION', 'us-east-1');

const BRAVE_SEARCH_HOSTNAME = 'api.search.brave.com';
const BRAVE_SEARCH_PATH = '/res/v1/web/search';

/** Delay before the single 429 retry — just over the free tier's 1 req/sec. */
const RATE_LIMIT_RETRY_DELAY_MS = 1100;

/** Default number of results per query. */
const DEFAULT_RESULT_COUNT = 5;

// Cache for API key to avoid repeated SSM calls in warm Lambda containers
let cachedApiKey: string | null = null;

/** Normalized web search result — the provider-agnostic shape. */
export const WebSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export type WebSearchOptions = {
  /** Max results to return (default 5). */
  count?: number;
};

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

/**
 * Get the Brave Search API key from SSM Parameter Store with caching.
 */
const getApiKey = async (): Promise<string | null> => {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  try {
    const ssmClient = new SSMClient({ region: REGION });
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: SSM_PARAM_NAME,
        WithDecryption: true,
      }),
    );

    if (response.Parameter?.Value) {
      cachedApiKey = response.Parameter.Value;
      console.log('Successfully retrieved Brave Search API key from SSM');
      return cachedApiKey;
    }
  } catch (error) {
    console.warn('Failed to retrieve Brave Search API key from SSM:', error);
  }

  return null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type HttpError = Error & { statusCode?: number };

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

/**
 * Search the web and return normalized `{title, url, snippet}` results.
 * Retries once on 429 (Brave free tier: 1 req/sec); throws on any other
 * failure or when the API key is unavailable.
 */
export const webSearch = async (
  query: string,
  opts?: WebSearchOptions,
): Promise<WebSearchResult[]> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error(
      `Brave Search API key not found in SSM (${SSM_PARAM_NAME}). Web search is unavailable.`,
    );
  }

  const count = opts?.count ?? DEFAULT_RESULT_COUNT;

  try {
    return normalizeBraveResults(await braveSearchRequest(query, count, apiKey), count);
  } catch (err) {
    const statusCode = (err as HttpError).statusCode;
    if (statusCode !== 429) {
      throw err;
    }
    console.warn(`[web-search] 429 from Brave, retrying once in ${RATE_LIMIT_RETRY_DELAY_MS}ms...`);
    await sleep(RATE_LIMIT_RETRY_DELAY_MS);
    return normalizeBraveResults(await braveSearchRequest(query, count, apiKey), count);
  }
};

/** Test-only: clear the warm-container API key cache. */
export const __resetWebSearchApiKeyCacheForTests = (): void => {
  cachedApiKey = null;
};
