import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { requireEnv } from './env';
import { AUDIT_HMAC_SECRET_PARAM } from '@/constants/audit';

const REGION = requireEnv('REGION', 'us-east-1');
const client = new SecretsManagerClient({ region: REGION });
const ssmClient = new SSMClient({ region: REGION });

// warm Lambda cache
const cache = new Map<string, string>();
let cachedHmacSecret: string | null = null;

/**
 * Reads a plain-string secret from Secrets Manager by ARN or name.
 */
export async function readPlainSecret(secretArnOrId: string): Promise<string> {
  if (!secretArnOrId?.trim()) {
    throw new Error('Secret ARN/ID is required');
  }

  const cached = cache.get(secretArnOrId);
  if (cached) return cached;

  const res = await client.send(
    new GetSecretValueCommand({ SecretId: secretArnOrId }),
  );

  const value = res.SecretString?.trim();
  if (!value) {
    throw new Error('Secret value is empty');
  }

  cache.set(secretArnOrId, value);
  return value;
}

/**
 * Fetch the HMAC secret for audit log integrity signing from SSM Parameter Store.
 * Cached in Lambda memory for the lifetime of the invocation.
 */
export const getHmacSecret = async (): Promise<string> => {
  if (cachedHmacSecret) return cachedHmacSecret;

  const res = await ssmClient.send(
    new GetParameterCommand({
      Name: AUDIT_HMAC_SECRET_PARAM,
      WithDecryption: true,
    }),
  );

  cachedHmacSecret = res.Parameter?.Value ?? '';
  return cachedHmacSecret;
};
