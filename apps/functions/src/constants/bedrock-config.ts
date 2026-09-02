/** Single-table PK for the per-org Bedrock configuration entity. */
export const BEDROCK_CONFIG_PK = 'BEDROCK_CONFIG';

/**
 * Secrets Manager prefix for the per-org Bedrock Bearer key.
 * Yields secret name `bedrock-api-key-<orgId>` via the shared
 * `${prefix}-api-key-${orgId}` convention in api-key-storage.ts.
 */
export const BEDROCK_SECRET_PREFIX = 'bedrock';
