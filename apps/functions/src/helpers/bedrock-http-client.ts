import https from 'https';
import { requireEnv } from './env';
import { getApiKey as getStoredApiKey } from './api-key-storage';
import { getBedrockConfig } from './bedrock-config';
import { BEDROCK_SECRET_PREFIX } from '@/constants/bedrock-config';
import { AiNotConfiguredError } from './ai-config-error';
import { TransientServiceError } from '@/sentry-lambda';

const BEDROCK_REGION = requireEnv('BEDROCK_REGION', 'us-east-1');

// ─── Per-org key resolution (ticket 09) ─────────────────────────────────────
//
// Each invoke resolves the caller's own Bedrock key from `orgId` via Secrets
// Manager (`bedrock-api-key-<orgId>`). There is a SINGLE resolution path — no
// shared SSM key and no cross-org fallback. An org with no valid key throws a
// typed `AiNotConfiguredError` (fail-closed).

/** Short TTL so a rotated/revoked key is picked up within minutes on warm containers. */
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-org key cache. Keyed by orgId so org A can never resolve org B's key. */
const keyCache = new Map<string, { key: string; expiresAt: number }>();

const fetchOrgKey = async (orgId: string): Promise<string> => {
  const key = await getStoredApiKey(orgId, BEDROCK_SECRET_PREFIX);
  if (!key) {
    throw new AiNotConfiguredError(orgId);
  }
  return key;
};

/** Resolve the org's key, using the cache within its TTL. */
const resolveOrgKey = async (orgId: string): Promise<string> => {
  const cached = keyCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }
  const key = await fetchOrgKey(orgId);
  keyCache.set(orgId, { key, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  return key;
};

const evictOrgKey = (orgId: string): void => {
  keyCache.delete(orgId);
};

/** A Bedrock 401/403 means the resolved key is bad/stale — evict and refetch. */
const isAuthError = (e: { statusCode?: number }): boolean =>
  e.statusCode === 401 || e.statusCode === 403;

/**
 * A model the key can't invoke (missing access or nonexistent id). For a TEXT
 * role this triggers a one-shot retry on the org's configured fallback model;
 * for embeddings (titan) it is a hard error with no fallback.
 */
const MODEL_UNAVAILABLE_PATTERN = /ResourceNotFoundException|AccessDenied/i;
const isModelUnavailable = (e: { statusCode?: number; body?: string; message?: string }): boolean =>
  e.statusCode === 404 ||
  MODEL_UNAVAILABLE_PATTERN.test(e.body ?? '') ||
  MODEL_UNAVAILABLE_PATTERN.test(e.message ?? '');

/** Titan embedding models take no text-model fallback (ADR-004). */
const isEmbeddingModel = (modelId: string): boolean => modelId.includes('embed');

const THROTTLE_RETRY_DELAYS_MS = [2000, 5000, 12000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isThrottleError = (statusCode: number | undefined, body: string): boolean => {
  if (statusCode === 429) return true;
  return body.includes('ThrottlingException') || body.includes('TooManyRequestsException');
};

/** Throttling (429) plus transient 5xx — both are worth a short exponential backoff. */
const isTransientError = (statusCode: number | undefined, body: string): boolean =>
  isThrottleError(statusCode, body) ||
  (statusCode !== undefined && statusCode >= 500 && statusCode < 600);

/**
 * Invoke Bedrock model using HTTP request with Bearer token.
 * Retries up to 3 times on throttling (429 / ThrottlingException) or transient
 * 5xx responses with exponential backoff.
 */
async function invokeModelWithHttp(
  modelId: string,
  body: string,
  apiKey: string
): Promise<Uint8Array> {
  const hostname = `bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`;
  const path = `/model/${modelId}/invoke`;

  const options = {
    hostname,
    port: 443,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${apiKey}`,
    },
  };

  const attempt = (): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(new Uint8Array(buffer));
          } else {
            const errorMessage = buffer.toString('utf-8');
            const statusCode = res.statusCode ?? 500;
            if (statusCode >= 500) {
              reject(new TransientServiceError(
                `Bedrock HTTP request failed: ${statusCode} ${res.statusMessage} - ${errorMessage}`,
                statusCode,
              ));
            } else {
              reject(
                Object.assign(
                  new Error(`Bedrock HTTP request failed: ${statusCode} ${res.statusMessage} - ${errorMessage}`),
                  { statusCode, body: errorMessage },
                )
              );
            }
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });

  let lastErr: Error & { statusCode?: number; body?: string } = new Error('No attempts made');
  for (let i = 0; i <= THROTTLE_RETRY_DELAYS_MS.length; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err as Error & { statusCode?: number; body?: string };
      if (i < THROTTLE_RETRY_DELAYS_MS.length && isTransientError(lastErr.statusCode, lastErr.body ?? lastErr.message)) {
        const delay = THROTTLE_RETRY_DELAYS_MS[i]!;
        console.warn(`[bedrock] transient error (${lastErr.statusCode}) on attempt ${i + 1}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

/**
 * Invoke a Bedrock model via the HTTP client using the org's own Bearer key.
 *
 * `orgId` is REQUIRED (ticket 09): the key is resolved per-org from Secrets
 * Manager, cached with a short TTL, and there is no shared/global fallback. An
 * org with no valid key throws {@link AiNotConfiguredError}.
 *
 * Retry behavior (beyond the throttling retry inside `invokeModelWithHttp`):
 *  - **Auth (401/403):** the cached key is dropped, refetched once, and the
 *    invoke retried — covering a key rotated out from under a warm container.
 *  - **Text-model gap (ResourceNotFound/AccessDenied on a non-embedding model):**
 *    retried once on the org's configured `fallbackModelId`, if any.
 *  - **Embeddings (titan):** no fallback — a failure is a hard error.
 */
export async function invokeModel(
  modelId: string,
  body: string,
  orgId: string,
): Promise<Uint8Array> {
  const key = await resolveOrgKey(orgId);

  try {
    return await invokeModelWithHttp(modelId, body, key);
  } catch (err) {
    const e = err as Error & { statusCode?: number; body?: string };

    // (a) Text-role model gap → retry once on the org's fallback model.
    //     Embeddings have no fallback: surface the failure as-is (hard error).
    if (!isEmbeddingModel(modelId) && isModelUnavailable(e)) {
      const fallbackModelId = (await getBedrockConfig(orgId))?.fallbackModelId;
      if (fallbackModelId && fallbackModelId !== modelId) {
        console.warn(
          `[bedrock] model ${modelId} unavailable for org ${orgId}; retrying on fallback ${fallbackModelId}`,
        );
        return await invokeModelWithHttp(fallbackModelId, body, key);
      }
      console.error(
        `[bedrock] model ${modelId} unavailable for org ${orgId} and no fallback configured: ${e.message}`,
      );
      throw e;
    }

    // (b) Stale/invalid key → evict, refetch once, retry with the same model.
    //     A refetch that finds no key throws AiNotConfiguredError.
    if (isAuthError(e)) {
      console.warn(
        `[bedrock] auth failure (${e.statusCode}) for org ${orgId}; evicting cached key and retrying`,
      );
      evictOrgKey(orgId);
      const freshKey = await resolveOrgKey(orgId);
      return await invokeModelWithHttp(modelId, body, freshKey);
    }

    throw e;
  }
}

/**
 * Build the smallest valid invoke body for a probe of `modelId`.
 * Titan embedding models take `{ inputText }`; Claude text models take a
 * one-token Anthropic messages request.
 */
const buildProbeBody = (modelId: string): string => {
  if (modelId.includes('embed')) {
    return JSON.stringify({ inputText: 'ping' });
  }
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
};

/**
 * Probe a single model with an EXPLICIT key — independent of per-org
 * resolution/caching. Used by the save-time probe (ticket 04) to validate a
 * just-submitted key before it is stored anywhere.
 *
 * Returns `{ ok: true }` when the tiny test invoke succeeds, or
 * `{ ok: false, error }` with a short reason (e.g. the AWS error name) on
 * failure. It never throws — a missing/inaccessible model is a normal result.
 */
export async function probeModel(
  modelId: string,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await invokeModelWithHttp(modelId, buildProbeBody(modelId), apiKey);
    return { ok: true };
  } catch (err) {
    const e = err as Error & { statusCode?: number; body?: string };
    // Prefer a compact, structured reason: the AWS error name if present in the
    // response body, else the status code, else the message.
    const bodyText = e.body ?? '';
    const nameMatch = bodyText.match(/"__type"\s*:\s*"([^"]+)"/) ?? bodyText.match(/(\w+Exception)/);
    const reason = nameMatch?.[1] ?? (e.statusCode ? `HTTP ${e.statusCode}` : e.message);
    return { ok: false, error: reason };
  }
}

