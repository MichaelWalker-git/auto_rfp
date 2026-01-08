import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { requireEnv } from './env';

const REGION = requireEnv('REGION', 'us-east-1');
const client = new SecretsManagerClient({ region: REGION });

// warm Lambda cache
const cache = new Map<string, string>();

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
