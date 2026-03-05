/**
 * Re-export barrel for backward compatibility.
 *
 * DB-only helpers (no @smithy / @aws-crypto dependencies) live in `apn-db.ts`.
 * Partner Central API client + registration logic live in `apn-client.ts`.
 *
 * ⚠️  Importing from this file pulls in `@smithy/signature-v4` and
 *     `@aws-crypto/sha256-js` which are NOT available in the Lambda runtime
 *     when marked as external modules.  Prefer importing directly from
 *     `@/helpers/apn-db` or `@/helpers/apn-client` in Lambda handlers.
 */

// DB helpers (safe for all Lambdas)
export {
  buildApnRegistrationSk,
  buildApnRegistrationSkPrefix,
  buildApnCredentialsSk,
  saveApnCredentials,
  getApnCredentialsMeta,
  getApnSecretKeys,
  createApnRegistration,
  updateApnRegistration,
  getApnRegistration,
} from '@/helpers/apn-db';

// Partner Central API client (requires @smithy/signature-v4 + @aws-crypto/sha256-js)
export {
  triggerApnRegistration,
  retryApnRegistration,
} from '@/helpers/apn-client';

export type {
  TriggerApnRegistrationArgs,
  RetryApnRegistrationArgs,
} from '@/helpers/apn-client';
