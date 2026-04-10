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

/**
 * Invoke Bedrock model using HTTP request with Bearer token
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

  return new Promise((resolve, reject) => {
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
            new Error(
              `Bedrock HTTP request failed: ${res.statusCode} ${res.statusMessage} - ${errorMessage}`
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

