import { 
  SecretsManagerClient, 
  GetSecretValueCommand, 
  PutSecretValueCommand, 
  CreateSecretCommand,
  ResourceNotFoundException 
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

/**
 * Stores API key in AWS Secrets Manager (handles encryption automatically)
 * Creates the secret if it doesn't exist, otherwise updates it
 * @param orgId - Organization ID
 * @param apiKey - API key to store
 * @param prefix - Optional prefix for the secret name
 */
export async function storeApiKey(orgId: string, prefix: string, apiKey: string): Promise<void> {
  const secretName = `${prefix}-api-key-${orgId}`;

  try {
    // First, try to update the existing secret
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: apiKey,
      })
    );
    console.log(`Successfully updated API key for orgId: ${orgId}`);
  } catch (error: any) {
    // If the secret doesn't exist, create it
    if (error instanceof ResourceNotFoundException || error.name === 'ResourceNotFoundException') {
      try {
        await secretsClient.send(
          new CreateSecretCommand({
            Name: secretName,
            SecretString: apiKey,
            Description: `${prefix} API key for organization ${orgId}`,
          })
        );
        console.log(`Successfully created new API key secret for orgId: ${orgId}`);
      } catch (createError) {
        console.error('Failed to create API key secret for orgId:', orgId, createError);
        throw createError;
      }
    } else {
      // For any other error, log and rethrow
      console.error('Failed to store API key for orgId:', orgId, error);
      throw error;
    }
  }
}

/**
 * Retrieves API key from AWS Secrets Manager (automatically decrypted)
 * @param orgId - Organization ID
 * @param prefix - Optional prefix for the secret name
 */
export async function getApiKey(orgId: string, prefix: string): Promise<string | null> {
  try {
    const secretName = `${prefix}-api-key-${orgId}`;
    
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      })
    );

    return response.SecretString || null;
  } catch (error: any) {
    // If the secret doesn't exist, return null instead of throwing
    if (error instanceof ResourceNotFoundException || error.name === 'ResourceNotFoundException') {
      console.log(`API key secret not found for orgId: ${orgId}`);
      return null;
    }
    
    console.error('Failed to retrieve API key for orgId:', orgId, error);
    throw error;
  }
}
