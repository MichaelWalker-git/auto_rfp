import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  RestoreSecretCommand,
  ResourceNotFoundException,
  InvalidRequestException,
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
  } catch (error: unknown) {
    const isNotFound = error instanceof ResourceNotFoundException || (error as { name?: string }).name === 'ResourceNotFoundException';
    const isMarkedForDeletion = error instanceof InvalidRequestException || (error as { name?: string }).name === 'InvalidRequestException';

    if (isMarkedForDeletion) {
      // Secret was scheduled for deletion — restore it, then update
      await secretsClient.send(new RestoreSecretCommand({ SecretId: secretName }));
      await secretsClient.send(
        new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: apiKey,
        })
      );
      console.log(`Restored and updated API key for orgId: ${orgId}`);
    } else if (isNotFound) {
      // Secret doesn't exist — create it
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
  } catch (error: unknown) {
    const isNotFound = error instanceof ResourceNotFoundException || (error as { name?: string }).name === 'ResourceNotFoundException';
    const isMarkedForDeletion = error instanceof InvalidRequestException || (error as { name?: string }).name === 'InvalidRequestException';

    if (isNotFound || isMarkedForDeletion) {
      console.log(`API key secret not available for orgId: ${orgId} (${isMarkedForDeletion ? 'pending deletion' : 'not found'})`);
      return null;
    }

    console.error('Failed to retrieve API key for orgId:', orgId, error);
    throw error;
  }
}
