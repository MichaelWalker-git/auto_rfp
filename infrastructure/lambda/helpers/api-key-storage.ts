import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});
const API_KEY_SECRET_PREFIX = 'samgov-api-key';

/**
 * Stores API key in AWS Secrets Manager (handles encryption automatically)
 */
export async function storeApiKey(orgId: string, apiKey: string): Promise<void> {
  try {
    const secretName = `${API_KEY_SECRET_PREFIX}-${orgId}`;

    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: apiKey,
      })
    );
  } catch (error) {
    console.error('Failed to store API key', error);
    throw error;
  }
}

/**
 * Retrieves API key from AWS Secrets Manager (automatically decrypted)
 */
export async function getApiKey(orgId: string): Promise<string | null> {
  try {
    const secretName = `${API_KEY_SECRET_PREFIX}-${orgId}`;
    
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      })
    );

    return response.SecretString || null;
  } catch (error) {
    console.error('Failed to retrieve API key', error);
    throw error;
  }
}
