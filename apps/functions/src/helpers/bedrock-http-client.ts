import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import https from 'https';
import { requireEnv } from './env';

const SSM_PARAM_NAME = requireEnv('BEDROCK_API_KEY_SSM_PARAM', '/auto-rfp/bedrock/api-key');
const BEDROCK_REGION = requireEnv('BEDROCK_REGION', 'us-east-1');

// Cache for API key to avoid repeated SSM calls in warm Lambda containers
let cachedApiKey: string | null = null;

/**
 * Get the Bedrock API key from SSM Parameter Store with caching.
 */
const getApiKey = async (): Promise<string> => {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  const ssmClient = new SSMClient({ region: BEDROCK_REGION });
  const response = await ssmClient.send(
    new GetParameterCommand({
      Name: SSM_PARAM_NAME,
      WithDecryption: true,
    })
  );

  if (!response.Parameter?.Value) {
    throw new Error(`SSM parameter ${SSM_PARAM_NAME} has no value`);
  }

  cachedApiKey = response.Parameter.Value;
  console.log('Successfully retrieved Bedrock API key from SSM');
  return cachedApiKey;
};

/**
 * Invoke Bedrock model using raw HTTPS with a bearer token from SSM.
 */
export const invokeModel = async (
  modelId: string,
  body: string,
): Promise<Uint8Array> => {
  const apiKey = await getApiKey();
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
};
