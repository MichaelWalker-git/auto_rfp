import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import https from 'https';
import { requireEnv } from './env';

const SSM_PARAM_NAME = requireEnv('BEDROCK_API_KEY_SSM_PARAM','/auto-rfp/bedrock/api-key');
const BEDROCK_REGION = requireEnv('BEDROCK_REGION', 'us-east-1');

// Cache for API key to avoid repeated SSM calls in warm Lambda containers
let cachedApiKey: string | null = null;

/**
 * Get the Bedrock API key from SSM Parameter Store with caching
 */
async function getApiKey(): Promise<string | null> {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  try {
    const ssmClient = new SSMClient({ region: BEDROCK_REGION });
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: SSM_PARAM_NAME,
        WithDecryption: true,
      })
    );

    if (response.Parameter?.Value) {
      cachedApiKey = response.Parameter.Value;
      console.log('Successfully retrieved Bedrock API key from SSM');
      return cachedApiKey;
    }
  } catch (error) {
    console.warn('Failed to retrieve Bedrock API key from SSM:', error);
  }

  return null;
}

const THROTTLE_RETRY_DELAYS_MS = [2000, 5000, 12000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isThrottleError = (statusCode: number | undefined, body: string): boolean => {
  if (statusCode === 429) return true;
  return body.includes('ThrottlingException') || body.includes('TooManyRequestsException');
};

/**
 * Invoke Bedrock model using HTTP request with Bearer token.
 * Retries up to 3 times on throttling (429 / ThrottlingException) with exponential backoff.
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
            reject(
              Object.assign(
                new Error(`Bedrock HTTP request failed: ${res.statusCode} ${res.statusMessage} - ${errorMessage}`),
                { statusCode: res.statusCode, body: errorMessage },
              )
            );
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
      if (i < THROTTLE_RETRY_DELAYS_MS.length && isThrottleError(lastErr.statusCode, lastErr.body ?? lastErr.message)) {
        const delay = THROTTLE_RETRY_DELAYS_MS[i]!;
        console.warn(`[bedrock] ThrottlingException on attempt ${i + 1}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

/**
 * Invoke Bedrock model - uses API key if available, falls back to SDK
 */
export async function invokeModel(
  modelId: string,
  body: string,
  contentType: string = 'application/json',
  accept: string = 'application/json'
): Promise<Uint8Array> {
  // Try to get API key
  const apiKey = await getApiKey();

  if (!apiKey) {
    throw new Error(
      `Bedrock API key not found in SSM (${SSM_PARAM_NAME}). ` +
      `Bedrock must be called via HTTP client with API key — SDK fallback is not allowed.`,
    );
  }

  console.log(`Invoking Bedrock model ${modelId} with API key authentication`);
  return await invokeModelWithHttp(modelId, body, apiKey);
}

