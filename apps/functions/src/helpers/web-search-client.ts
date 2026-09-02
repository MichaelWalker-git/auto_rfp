/**
 * web-search-client.ts
 *
 * Provider-agnostic web search client, mirroring `bedrock-http-client.ts`:
 * the exported `webSearch(query, opts)` returns normalized results and hides
 * the provider behind it. Providers live in `helpers/web-search-providers/`
 * (Brave, Tavily) and are selected per stage via the `WEB_SEARCH_PROVIDER`
 * env var (`'brave' | 'tavily'`, default `'tavily'` — Brave dropped its free
 * tier, T15). Each provider's API key comes from its own SSM parameter
 * (Tavily `/auto-rfp/tavily/api-key`, Brave `/auto-rfp/brave-search/api-key`)
 * and is cached per provider in the warm container.
 *
 * On a 429 the client retries ONCE after a short delay; a second 429 (or any
 * other failure, including an unknown provider or missing key) throws, and
 * callers (service-pricing) degrade per ADR-15 instead of failing documents.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { requireEnv } from './env';
import { sleep } from './sleep';
import { braveProvider } from './web-search-providers/brave';
import { tavilyProvider } from './web-search-providers/tavily';
import type { HttpError, WebSearchProvider, WebSearchResult } from './web-search-providers/types';

export { WebSearchResultSchema } from './web-search-providers/types';
export type { WebSearchResult };

const REGION = requireEnv('REGION', 'us-east-1');

/** Delay before the single 429 retry — just over Brave's free-tier 1 req/sec. */
const RATE_LIMIT_RETRY_DELAY_MS = 1100;

/** Default number of results per query. */
const DEFAULT_RESULT_COUNT = 5;

const DEFAULT_PROVIDER_NAME = 'tavily';

const PROVIDERS: Record<string, WebSearchProvider> = {
  [braveProvider.name]: braveProvider,
  [tavilyProvider.name]: tavilyProvider,
};

// Per-provider API key cache to avoid repeated SSM calls in warm Lambda containers
const cachedApiKeys = new Map<string, string>();

export type WebSearchOptions = {
  /** Max results to return (default 5). */
  count?: number;
};

/**
 * Resolve the active provider from `WEB_SEARCH_PROVIDER`. Unknown values warn
 * and return null so `webSearch` throws and ADR-15 degradation kicks in.
 */
const getProvider = (): WebSearchProvider | null => {
  const name = process.env.WEB_SEARCH_PROVIDER || DEFAULT_PROVIDER_NAME;
  const provider = PROVIDERS[name];
  if (!provider) {
    console.warn(
      `[web-search] Unknown WEB_SEARCH_PROVIDER "${name}" (expected one of: ${Object.keys(PROVIDERS).join(', ')}). Web search is unavailable.`,
    );
    return null;
  }
  return provider;
};

/** SSM parameter name holding the provider's API key. */
const resolveSsmParamName = (provider: WebSearchProvider): string =>
  process.env[provider.ssmParamEnvVar] || provider.defaultSsmParamName;

/**
 * Get the provider's API key from SSM Parameter Store with per-provider caching.
 */
const getApiKey = async (provider: WebSearchProvider): Promise<string | null> => {
  const cached = cachedApiKeys.get(provider.name);
  if (cached) {
    return cached;
  }

  const paramName = resolveSsmParamName(provider);

  try {
    const ssmClient = new SSMClient({ region: REGION });
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: paramName,
        WithDecryption: true,
      }),
    );

    if (response.Parameter?.Value) {
      cachedApiKeys.set(provider.name, response.Parameter.Value);
      console.log(`Successfully retrieved ${provider.name} web search API key from SSM`);
      return response.Parameter.Value;
    }
  } catch (error) {
    console.warn(`Failed to retrieve ${provider.name} web search API key from SSM:`, error);
  }

  return null;
};

/**
 * Search the web and return normalized `{title, url, snippet}` results.
 * Retries once on 429; throws on any other failure, when the API key is
 * unavailable, or when `WEB_SEARCH_PROVIDER` names an unknown provider.
 */
export const webSearch = async (
  query: string,
  opts?: WebSearchOptions,
): Promise<WebSearchResult[]> => {
  const provider = getProvider();
  if (!provider) {
    throw new Error(
      `Unknown web search provider "${process.env.WEB_SEARCH_PROVIDER}". Web search is unavailable.`,
    );
  }

  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `${provider.name} web search API key not found in SSM (${resolveSsmParamName(provider)}). Web search is unavailable.`,
    );
  }

  const count = opts?.count ?? DEFAULT_RESULT_COUNT;

  try {
    return await provider.search(query, count, apiKey);
  } catch (err) {
    const statusCode = (err as HttpError).statusCode;
    if (statusCode !== 429) {
      throw err;
    }
    console.warn(
      `[web-search] 429 from ${provider.name}, retrying once in ${RATE_LIMIT_RETRY_DELAY_MS}ms...`,
    );
    await sleep(RATE_LIMIT_RETRY_DELAY_MS);
    return provider.search(query, count, apiKey);
  }
};

/** Test-only: clear the warm-container API key cache. */
export const __resetWebSearchApiKeyCacheForTests = (): void => {
  cachedApiKeys.clear();
};
