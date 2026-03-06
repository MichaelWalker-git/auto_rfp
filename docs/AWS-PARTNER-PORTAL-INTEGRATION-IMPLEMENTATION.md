# AWS Partner Portal Integration — Implementation Guide <!-- ⏳ PENDING -->

> Implementation-ready architecture document for integrating Auto RFP with the AWS Partner Network (APN) portal to automatically register and credit proposal submissions.

---

## 1. Overview <!-- ⏳ PENDING -->

| Field | Value |
|---|---|
| **Feature Name** | AWS Partner Portal Integration |
| **Domain** | `apn` (AWS Partner Network) |
| **Trigger** | Proposal submission (opportunity stage → `SUBMITTED`) |
| **External API** | AWS Partner Central API (ACE — APN Customer Engagements) |
| **Credentials** | Per-org AWS Partner credentials stored in Secrets Manager |
| **Audit** | Full audit trail for every registration attempt |
| **Retry** | Manual retry endpoint for failed registrations |
| **Frontend** | Registration status badge on proposal detail + settings page for credentials |

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Auto RFP Backend                                   │
│                                                                             │
│  POST /project-outcome/set-outcome                                          │
│       │                                                                     │
│       ▼                                                                     │
│  set-outcome.ts ──► onProjectOutcomeSet() ──► stage → SUBMITTED             │
│                                                    │                        │
│                                                    ▼                        │
│                                         triggerApnRegistration()            │
│                                         (non-blocking .catch)               │
│                                                    │                        │
│                                                    ▼                        │
│                                    ┌───────────────────────────┐            │
│                                    │  apn-registration helper  │            │
│                                    │  1. getApnCredentials()   │            │
│                                    │  2. registerOpportunity() │            │
│                                    │     (Partner Central API) │            │
│                                    │  3. saveApnRegistration() │            │
│                                    │  4. writeAuditLog()       │            │
│                                    └───────────────────────────┘            │
│                                                                             │
│  REST Endpoints:                                                            │
│  GET  /apn/credentials          ← check if credentials configured          │
│  POST /apn/credentials          ← save Partner Central credentials         │
│  GET  /apn/registration         ← get registration status for opportunity  │
│  POST /apn/retry-registration   ← manual retry for failed registrations    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────┐
                          │  AWS Partner Central API │
                          │  (ACE — APN Customer     │
                          │   Engagements)           │
                          └─────────────────────────┘
```

### Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trigger mechanism | Non-blocking call inside `onProjectOutcomeSet()` | Keeps proposal submission fast; APN registration is best-effort |
| Credential storage | AWS Secrets Manager (per-org) | Consistent with Linear API key pattern; encrypted at rest |
| Registration record | DynamoDB (single-table) | Queryable by opportunity; tracks status + retry history |
| Retry strategy | Manual retry endpoint + exponential backoff in helper | Avoids silent failures; gives users control |
| APN API auth | AWS SigV4 (Partner Central API) | Required by AWS Partner Central API |

---

## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

**File:** `packages/core/src/schemas/apn.ts`

```typescript
import { z } from 'zod';

// ─── APN Registration Status ──────────────────────────────────────────────────

export const ApnRegistrationStatusSchema = z.enum([
  'PENDING',       // Registration queued but not yet attempted
  'REGISTERED',    // Successfully registered in Partner Portal
  'FAILED',        // Registration attempt failed
  'RETRYING',      // Manual retry in progress
  'NOT_CONFIGURED', // No APN credentials configured for this org
]);
export type ApnRegistrationStatus = z.infer<typeof ApnRegistrationStatusSchema>;

// ─── AWS Services Involved ────────────────────────────────────────────────────

export const AwsServiceSchema = z.enum([
  'EC2', 'S3', 'RDS', 'Lambda', 'ECS', 'EKS', 'SageMaker',
  'Bedrock', 'DynamoDB', 'CloudFront', 'API_Gateway', 'Cognito',
  'Step_Functions', 'SNS', 'SQS', 'Kinesis', 'Glue', 'Athena',
  'QuickSight', 'Connect', 'Lex', 'Rekognition', 'Textract',
  'Comprehend', 'Translate', 'Polly', 'Transcribe', 'Other',
]);
export type AwsService = z.infer<typeof AwsServiceSchema>;

// ─── APN Registration Item (stored in DynamoDB) ───────────────────────────────

export const ApnRegistrationItemSchema = z.object({
  // Identity
  registrationId: z.string().uuid(),
  orgId:          z.string().min(1),
  projectId:      z.string().min(1),
  oppId:          z.string().min(1),

  // Registration status
  status:         ApnRegistrationStatusSchema,
  apnOpportunityId: z.string().optional(),   // ID returned by Partner Central API
  apnOpportunityUrl: z.string().url().optional(), // Deep-link into Partner Portal

  // Opportunity fields sent to APN
  customerName:       z.string().min(1),
  opportunityValue:   z.number().nonnegative(),
  awsServices:        z.array(AwsServiceSchema).min(1),
  expectedCloseDate:  z.string().datetime(),
  proposalStatus:     z.enum(['SUBMITTED', 'WON', 'LOST']),
  description:        z.string().max(2000).optional(),

  // Error tracking
  lastError:          z.string().optional(),
  retryCount:         z.number().int().nonnegative().default(0),
  lastAttemptAt:      z.string().datetime().optional(),

  // Audit
  registeredBy:       z.string().min(1),   // userId or 'system'
  createdAt:          z.string().datetime(),
  updatedAt:          z.string().datetime(),
});
export type ApnRegistrationItem = z.infer<typeof ApnRegistrationItemSchema>;

// ─── Create DTO ───────────────────────────────────────────────────────────────

export const CreateApnRegistrationSchema = ApnRegistrationItemSchema.omit({
  registrationId: true,
  status: true,
  apnOpportunityId: true,
  apnOpportunityUrl: true,
  lastError: true,
  retryCount: true,
  lastAttemptAt: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateApnRegistration = z.infer<typeof CreateApnRegistrationSchema>;

// ─── Retry DTO ────────────────────────────────────────────────────────────────

export const RetryApnRegistrationSchema = z.object({
  orgId:          z.string().min(1),
  projectId:      z.string().min(1),
  oppId:          z.string().min(1),
  registrationId: z.string().uuid(),
});
export type RetryApnRegistration = z.infer<typeof RetryApnRegistrationSchema>;

// ─── Credentials DTO ─────────────────────────────────────────────────────────

export const SaveApnCredentialsSchema = z.object({
  orgId:          z.string().min(1),
  partnerId:      z.string().min(1, 'AWS Partner ID is required'),
  accessKeyId:    z.string().min(16, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  /** Optional: AWS region for Partner Central API (default: us-east-1) */
  region:         z.string().optional().default('us-east-1'),
});
export type SaveApnCredentials = z.infer<typeof SaveApnCredentialsSchema>;

export const GetApnCredentialsResponseSchema = z.object({
  configured: z.boolean(),
  partnerId:  z.string().optional(),
  region:     z.string().optional(),
  configuredAt: z.string().datetime().optional(),
});
export type GetApnCredentialsResponse = z.infer<typeof GetApnCredentialsResponseSchema>;

// ─── API Response Types ───────────────────────────────────────────────────────

export const ApnRegistrationResponseSchema = z.object({
  registration: ApnRegistrationItemSchema.nullable(),
});
export type ApnRegistrationResponse = z.infer<typeof ApnRegistrationResponseSchema>;

export const RetryApnRegistrationResponseSchema = z.object({
  ok:           z.boolean(),
  registration: ApnRegistrationItemSchema,
});
export type RetryApnRegistrationResponse = z.infer<typeof RetryApnRegistrationResponseSchema>;
```

**Export from** `packages/core/src/schemas/index.ts`:
```typescript
export * from './apn';
```

---

## 4. DynamoDB Design <!-- ⏳ PENDING -->

### PK Constants

**File:** `apps/functions/src/constants/apn.ts`

```typescript
export const APN_REGISTRATION_PK = 'APN_REGISTRATION' as const;
export const APN_SECRET_PREFIX    = 'apn' as const;

/** Metadata record that stores non-secret credential info (partnerId, region, configuredAt) */
export const APN_CREDENTIALS_PK  = 'APN_CREDENTIALS' as const;
```

### Access Pattern Table

| Entity | PK | SK | Notes |
|---|---|---|---|
| APN Registration | `APN_REGISTRATION` | `{orgId}#{projectId}#{oppId}#{registrationId}` | One record per registration attempt |
| APN Credentials Metadata | `APN_CREDENTIALS` | `{orgId}` | Non-secret metadata (partnerId, region, configuredAt) |

### SK Builder Functions

**File:** `apps/functions/src/helpers/apn.ts` (SK builders section)

```typescript
export const buildApnRegistrationSk = (
  orgId: string,
  projectId: string,
  oppId: string,
  registrationId: string,
): string => `${orgId}#${projectId}#${oppId}#${registrationId}`;

export const buildApnRegistrationSkPrefix = (
  orgId: string,
  projectId: string,
  oppId: string,
): string => `${orgId}#${projectId}#${oppId}#`;

export const buildApnCredentialsSk = (orgId: string): string => orgId;
```

---

## 5. Backend — Lambda Handlers <!-- ⏳ PENDING -->

### File Structure

```
apps/functions/src/
├── constants/
│   └── apn.ts                              ← APN_REGISTRATION_PK, APN_SECRET_PREFIX
├── helpers/
│   └── apn.ts                              ← SK builders + all DynamoDB helpers + Partner Central API client
├── handlers/
│   └── apn/
│       ├── get-apn-credentials.ts          ← GET /apn/credentials
│       ├── save-apn-credentials.ts         ← POST /apn/credentials
│       ├── get-apn-registration.ts         ← GET /apn/registration
│       └── retry-apn-registration.ts       ← POST /apn/retry-registration
```

---

### `apps/functions/src/constants/apn.ts`

```typescript
export const APN_REGISTRATION_PK = 'APN_REGISTRATION' as const;
export const APN_SECRET_PREFIX    = 'apn' as const;
export const APN_CREDENTIALS_PK  = 'APN_CREDENTIALS' as const;

/** AWS Partner Central API base URL */
export const APN_PARTNER_CENTRAL_BASE_URL =
  'https://partnercentral.awspartner.com/api/v1';
```

---

### `apps/functions/src/helpers/apn.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import {
  SignatureV4,
} from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { createItem, putItem, getItem, queryBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { getApiKey, storeApiKey } from '@/helpers/api-key-storage';
import {
  APN_REGISTRATION_PK,
  APN_SECRET_PREFIX,
  APN_CREDENTIALS_PK,
  APN_PARTNER_CENTRAL_BASE_URL,
} from '@/constants/apn';
import { PK_NAME, SK_NAME } from '@/constants/common';
import type {
  ApnRegistrationItem,
  CreateApnRegistration,
  SaveApnCredentials,
  GetApnCredentialsResponse,
} from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildApnRegistrationSk = (
  orgId: string,
  projectId: string,
  oppId: string,
  registrationId: string,
): string => `${orgId}#${projectId}#${oppId}#${registrationId}`;

export const buildApnRegistrationSkPrefix = (
  orgId: string,
  projectId: string,
  oppId: string,
): string => `${orgId}#${projectId}#${oppId}#`;

export const buildApnCredentialsSk = (orgId: string): string => orgId;

// ─── Credentials (Secrets Manager + DynamoDB metadata) ───────────────────────

/** Stored as JSON in Secrets Manager: { accessKeyId, secretAccessKey } */
const APN_CREDS_SECRET_KEY = 'apn-creds';

export const saveApnCredentials = async (dto: SaveApnCredentials): Promise<void> => {
  const { orgId, partnerId, accessKeyId, secretAccessKey, region } = dto;

  // Store sensitive keys in Secrets Manager
  const secretValue = JSON.stringify({ accessKeyId, secretAccessKey });
  await storeApiKey(orgId, APN_SECRET_PREFIX, secretValue);

  // Store non-secret metadata in DynamoDB for quick lookup
  await putItem(
    APN_CREDENTIALS_PK,
    buildApnCredentialsSk(orgId),
    {
      orgId,
      partnerId,
      region: region ?? 'us-east-1',
      configuredAt: nowIso(),
    },
  );
};

export const getApnCredentialsMeta = async (
  orgId: string,
): Promise<GetApnCredentialsResponse> => {
  const meta = await getItem<{
    orgId: string;
    partnerId: string;
    region: string;
    configuredAt: string;
  }>(APN_CREDENTIALS_PK, buildApnCredentialsSk(orgId));

  if (!meta) {
    return { configured: false };
  }

  return {
    configured: true,
    partnerId: meta.partnerId,
    region: meta.region,
    configuredAt: meta.configuredAt,
  };
};

const getApnSecretKeys = async (
  orgId: string,
): Promise<{ accessKeyId: string; secretAccessKey: string } | null> => {
  const raw = await getApiKey(orgId, APN_SECRET_PREFIX);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { accessKeyId: string; secretAccessKey: string };
  } catch {
    return null;
  }
};

// ─── Partner Central API Client ───────────────────────────────────────────────

interface ApnOpportunityPayload {
  partnerId:        string;
  customerName:     string;
  opportunityValue: number;
  awsServices:      string[];
  expectedCloseDate: string;
  proposalStatus:   string;
  description?:     string;
  externalId:       string;  // our registrationId — idempotency key
}

interface ApnOpportunityResponse {
  opportunityId:  string;
  opportunityUrl: string;
}

const callPartnerCentralApi = async (
  orgId: string,
  payload: ApnOpportunityPayload,
): Promise<ApnOpportunityResponse> => {
  const meta = await getApnCredentialsMeta(orgId);
  if (!meta.configured || !meta.partnerId) {
    throw new Error('APN credentials not configured for this organization');
  }

  const keys = await getApnSecretKeys(orgId);
  if (!keys) {
    throw new Error('APN secret keys not found in Secrets Manager');
  }

  const region = meta.region ?? 'us-east-1';
  const url = new URL(`${APN_PARTNER_CENTRAL_BASE_URL}/opportunities`);

  const body = JSON.stringify(payload);

  const request = new HttpRequest({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body,
  });

  const signer = new SignatureV4({
    credentials: {
      accessKeyId: keys.accessKeyId,
      secretAccessKey: keys.secretAccessKey,
    },
    region,
    service: 'partnercentral',
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  const response = await fetch(`${url.origin}${url.pathname}`, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Partner Central API error ${response.status}: ${errorText}`,
    );
  }

  return response.json() as Promise<ApnOpportunityResponse>;
};

// ─── DynamoDB Helpers ─────────────────────────────────────────────────────────

export const createApnRegistration = async (
  dto: CreateApnRegistration,
): Promise<ApnRegistrationItem> => {
  const registrationId = uuidv4();
  const now = nowIso();

  const item = await createItem<ApnRegistrationItem>(
    APN_REGISTRATION_PK,
    buildApnRegistrationSk(dto.orgId, dto.projectId, dto.oppId, registrationId),
    {
      ...dto,
      registrationId,
      status: 'PENDING',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  );

  return item;
};

export const updateApnRegistration = async (
  orgId: string,
  projectId: string,
  oppId: string,
  registrationId: string,
  patch: Partial<ApnRegistrationItem>,
): Promise<void> => {
  await putItem(
    APN_REGISTRATION_PK,
    buildApnRegistrationSk(orgId, projectId, oppId, registrationId),
    {
      ...patch,
      updatedAt: nowIso(),
    },
    true, // preserveCreatedAt
  );
};

export const getApnRegistration = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<ApnRegistrationItem | null> => {
  // Get the most recent registration for this opportunity
  const items = await queryBySkPrefix<ApnRegistrationItem>(
    APN_REGISTRATION_PK,
    buildApnRegistrationSkPrefix(orgId, projectId, oppId),
  );

  if (!items.length) return null;

  // Return the most recently created registration
  return items.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0] ?? null;
};

// ─── Core Registration Logic ──────────────────────────────────────────────────

/**
 * Registers an opportunity in the AWS Partner Portal.
 * Creates a registration record, calls the Partner Central API,
 * and updates the record with the result.
 *
 * Designed to be called non-blocking from onProjectOutcomeSet().
 */
export const triggerApnRegistration = async (args: {
  orgId:            string;
  projectId:        string;
  oppId:            string;
  customerName:     string;
  opportunityValue: number;
  awsServices:      string[];
  expectedCloseDate: string;
  proposalStatus:   'SUBMITTED' | 'WON' | 'LOST';
  description?:     string;
  registeredBy:     string;
}): Promise<void> => {
  const {
    orgId, projectId, oppId, customerName, opportunityValue,
    awsServices, expectedCloseDate, proposalStatus, description, registeredBy,
  } = args;

  // Check credentials first — if not configured, record NOT_CONFIGURED and return
  const meta = await getApnCredentialsMeta(orgId);
  if (!meta.configured) {
    console.info(`[APN] No credentials configured for org ${orgId} — skipping registration`);
    return;
  }

  // Create the registration record in PENDING state
  const registration = await createApnRegistration({
    orgId,
    projectId,
    oppId,
    customerName,
    opportunityValue,
    awsServices: awsServices as any,
    expectedCloseDate,
    proposalStatus,
    description,
    registeredBy,
  });

  const { registrationId } = registration;

  try {
    // Call Partner Central API
    const result = await callPartnerCentralApi(orgId, {
      partnerId:        meta.partnerId!,
      customerName,
      opportunityValue,
      awsServices,
      expectedCloseDate,
      proposalStatus,
      description,
      externalId:       registrationId,
    });

    // Update registration as REGISTERED
    await updateApnRegistration(orgId, projectId, oppId, registrationId, {
      status:            'REGISTERED',
      apnOpportunityId:  result.opportunityId,
      apnOpportunityUrl: result.opportunityUrl,
      lastAttemptAt:     nowIso(),
    });

    console.info(`[APN] Successfully registered opportunity ${oppId} → APN ID: ${result.opportunityId}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[APN] Registration failed for opportunity ${oppId}:`, errorMessage);

    // Update registration as FAILED
    await updateApnRegistration(orgId, projectId, oppId, registrationId, {
      status:        'FAILED',
      lastError:     errorMessage.substring(0, 500),
      lastAttemptAt: nowIso(),
    });
  }
};

/**
 * Retries a failed APN registration.
 * Updates the existing record's status to RETRYING, then attempts the API call.
 */
export const retryApnRegistration = async (args: {
  orgId:          string;
  projectId:      string;
  oppId:          string;
  registrationId: string;
  retriedBy:      string;
}): Promise<ApnRegistrationItem> => {
  const { orgId, projectId, oppId, registrationId, retriedBy } = args;

  const existing = await getItem<ApnRegistrationItem>(
    APN_REGISTRATION_PK,
    buildApnRegistrationSk(orgId, projectId, oppId, registrationId),
  );

  if (!existing) {
    throw new Error(`Registration ${registrationId} not found`);
  }

  if (existing.status === 'REGISTERED') {
    throw new Error('Registration already succeeded — no retry needed');
  }

  const meta = await getApnCredentialsMeta(orgId);
  if (!meta.configured) {
    throw new Error('APN credentials not configured — configure credentials before retrying');
  }

  // Mark as RETRYING
  await updateApnRegistration(orgId, projectId, oppId, registrationId, {
    status:        'RETRYING',
    lastAttemptAt: nowIso(),
    retryCount:    (existing.retryCount ?? 0) + 1,
    registeredBy:  retriedBy,
  });

  try {
    const result = await callPartnerCentralApi(orgId, {
      partnerId:        meta.partnerId!,
      customerName:     existing.customerName,
      opportunityValue: existing.opportunityValue,
      awsServices:      existing.awsServices,
      expectedCloseDate: existing.expectedCloseDate,
      proposalStatus:   existing.proposalStatus,
      description:      existing.description,
      externalId:       registrationId,
    });

    await updateApnRegistration(orgId, projectId, oppId, registrationId, {
      status:            'REGISTERED',
      apnOpportunityId:  result.opportunityId,
      apnOpportunityUrl: result.opportunityUrl,
      lastError:         undefined,
    });

    const updated = await getItem<ApnRegistrationItem>(
      APN_REGISTRATION_PK,
      buildApnRegistrationSk(orgId, projectId, oppId, registrationId),
    );

    return updated!;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await updateApnRegistration(orgId, projectId, oppId, registrationId, {
      status:    'FAILED',
      lastError: errorMessage.substring(0, 500),
    });

    throw err;
  }
};
```

---

### `apps/functions/src/handlers/apn/get-apn-credentials.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApnCredentialsMeta } from '@/helpers/apn';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const credentials = await getApnCredentialsMeta(orgId);
  return apiResponse(200, credentials);
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/apn/save-apn-credentials.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { saveApnCredentials } from '@/helpers/apn';
import { SaveApnCredentialsSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const bodyRaw = JSON.parse(event.body || '{}');
  const { success, data, error } = SaveApnCredentialsSchema.safeParse({
    ...bodyRaw,
    orgId,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  await saveApnCredentials(data);

  const userId = getUserId(event) ?? 'system';

  setAuditContext(event, {
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceId: 'apn-credentials',
  });

  // Non-blocking audit log for credential save
  writeAuditLog(
    {
      logId:          uuidv4(),
      timestamp:      nowIso(),
      userId,
      userName:       event.auth?.claims?.['cognito:username'] ?? userId,
      organizationId: orgId,
      action:         'API_KEY_CREATED',
      resource:       'api_key',
      resourceId:     'apn-credentials',
      changes: {
        after: { partnerId: data.partnerId, region: data.region },
      },
      ipAddress:  event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent:  event.headers?.['user-agent'] ?? 'system',
      result:     'success',
    },
    await getHmacSecret(),
  ).catch(err => console.warn('[APN] Audit log failed (non-blocking):', err.message));

  return apiResponse(200, {
    ok: true,
    message: 'APN credentials saved successfully',
  });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/apn/get-apn-registration.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApnRegistration } from '@/helpers/apn';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const registration = await getApnRegistration(orgId, projectId, oppId);

  return apiResponse(200, { registration });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
```

---

### `apps/functions/src/handlers/apn/retry-apn-registration.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { retryApnRegistration } from '@/helpers/apn';
import { RetryApnRegistrationSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const bodyRaw = JSON.parse(event.body || '{}');
  const { success, data, error } = RetryApnRegistrationSchema.safeParse({
    ...bodyRaw,
    orgId,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  const userId = getUserId(event) ?? 'system';

  try {
    const registration = await retryApnRegistration({
      orgId:          data.orgId,
      projectId:      data.projectId,
      oppId:          data.oppId,
      registrationId: data.registrationId,
      retriedBy:      userId,
    });

    setAuditContext(event, {
      action: 'INTEGRATION_SYNC_COMPLETED',
      resource: 'system',
      resourceId: data.registrationId,
    });

    return apiResponse(200, { ok: true, registration });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Non-blocking audit log for retry failure
    writeAuditLog(
      {
        logId:          uuidv4(),
        timestamp:      nowIso(),
        userId,
        userName:       event.auth?.claims?.['cognito:username'] ?? userId,
        organizationId: orgId,
        action:         'INTEGRATION_SYNC_FAILED',
        resource:       'system',
        resourceId:     data.registrationId,
        changes: {
          after: { error: errorMessage.substring(0, 500) },
        },
        ipAddress:    event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent:    event.headers?.['user-agent'] ?? 'system',
        result:       'failure',
        errorMessage: errorMessage.substring(0, 500),
      },
      await getHmacSecret(),
    ).catch(e => console.warn('[APN] Audit log failed (non-blocking):', e.message));

    return apiResponse(500, { message: errorMessage });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

---

### Integration Hook in `apps/functions/src/helpers/opportunity-stage.ts`

Add the following call inside `onProjectOutcomeSet()` when the stage transitions to `SUBMITTED`:

```typescript
// In onProjectOutcomeSet(), after the stage is updated to SUBMITTED:
import { triggerApnRegistration } from '@/helpers/apn';
import { getOpportunity } from '@/helpers/opportunity';

// Inside the SUBMITTED branch:
if (outcomeStatus === 'PENDING') {
  // Existing stage transition logic...

  // Trigger APN registration non-blocking
  const opp = await getOpportunity({ orgId, projectId, oppId });
  if (opp?.item) {
    triggerApnRegistration({
      orgId,
      projectId,
      oppId,
      customerName:      opp.item.organizationName ?? 'Unknown Customer',
      opportunityValue:  opp.item.baseAndAllOptionsValue ?? 0,
      awsServices:       ['Other'],   // default; user can configure in settings
      expectedCloseDate: opp.item.responseDeadlineIso ?? new Date().toISOString(),
      proposalStatus:    'SUBMITTED',
      description:       opp.item.description?.substring(0, 500),
      registeredBy:      changedBy,
    }).catch(err =>
      console.warn('[APN] triggerApnRegistration failed (non-blocking):', err.message),
    );
  }
}
```

---

### Audit Actions to Add

**File:** `packages/core/src/schemas/audit.ts` — add to `AuditActionSchema`:

```typescript
'APN_REGISTRATION_STARTED',
'APN_REGISTRATION_COMPLETED',
'APN_REGISTRATION_FAILED',
'APN_REGISTRATION_RETRIED',
```

**File:** `packages/core/src/schemas/audit.ts` — add to `AuditResourceSchema`:

```typescript
'apn_registration',
```

---

## 6. REST API Routes <!-- ⏳ PENDING -->

### `packages/infra/api/routes/apn.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const apnDomain = (): DomainRoutes => ({
  basePath: 'apn',
  routes: [
    {
      method:  'GET',
      path:    'credentials',
      entry:   lambdaEntry('apn/get-apn-credentials.ts'),
    },
    {
      method:  'POST',
      path:    'credentials',
      entry:   lambdaEntry('apn/save-apn-credentials.ts'),
    },
    {
      method:  'GET',
      path:    'registration',
      entry:   lambdaEntry('apn/get-apn-registration.ts'),
    },
    {
      method:  'POST',
      path:    'retry-registration',
      entry:   lambdaEntry('apn/retry-apn-registration.ts'),
    },
  ],
});
```

### Registration in `packages/infra/api/api-orchestrator-stack.ts`

```typescript
// Add import:
import { apnDomain } from './routes/apn.routes';

// Add to allDomains array:
apnDomain(),

// Add to domainStackNames array:
'ApnRoutes',
```

### Endpoint Summary

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/apn/credentials` | `org:manage_settings` | Check if APN credentials are configured |
| `POST` | `/apn/credentials` | `org:manage_settings` | Save Partner Central credentials |
| `GET` | `/apn/registration?orgId=&projectId=&oppId=` | `opportunity:read` | Get registration status for an opportunity |
| `POST` | `/apn/retry-registration` | `opportunity:edit` | Manually retry a failed registration |

---

## 7. Frontend — Hooks & Components <!-- ⏳ PENDING -->

### File Structure

```
apps/web/features/apn/
├── components/
│   ├── ApnRegistrationBadge.tsx     ← Status badge shown on proposal/opportunity detail
│   ├── ApnCredentialsForm.tsx       ← Settings form for Partner Central credentials
│   └── ApnRetryButton.tsx           ← Manual retry button for failed registrations
├── hooks/
│   ├── useApnRegistration.ts        ← SWR hook: GET /apn/registration
│   ├── useApnCredentials.ts         ← SWR hook: GET /apn/credentials
│   ├── useSaveApnCredentials.ts     ← Mutation: POST /apn/credentials
│   └── useRetryApnRegistration.ts   ← Mutation: POST /apn/retry-registration
└── index.ts                         ← Barrel export
```

---

### `apps/web/features/apn/hooks/useApnRegistration.ts`

```typescript
'use client';

import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/helpers/fetcher';
import type { ApnRegistrationResponse } from '@auto-rfp/core';

export const useApnRegistration = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const key =
    orgId && projectId && oppId
      ? `/apn/registration?orgId=${orgId}&projectId=${projectId}&oppId=${oppId}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<ApnRegistrationResponse>(
    key,
    authenticatedFetcher,
    { refreshInterval: 10_000 }, // poll every 10s while PENDING/RETRYING
  );

  return {
    registration: data?.registration ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
};
```

---

### `apps/web/features/apn/hooks/useApnCredentials.ts`

```typescript
'use client';

import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/helpers/fetcher';
import type { GetApnCredentialsResponse } from '@auto-rfp/core';

export const useApnCredentials = (orgId: string | undefined) => {
  const { data, error, isLoading, mutate } = useSWR<GetApnCredentialsResponse>(
    orgId ? `/apn/credentials?orgId=${orgId}` : null,
    authenticatedFetcher,
  );

  return {
    credentials: data,
    isConfigured: data?.configured ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
};
```

---

### `apps/web/features/apn/hooks/useSaveApnCredentials.ts`

```typescript
'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/helpers/fetcher';
import type { SaveApnCredentials } from '@auto-rfp/core';

export const useSaveApnCredentials = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (dto: SaveApnCredentials): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiMutate('/apn/credentials', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { save, isLoading, error };
};
```

---

### `apps/web/features/apn/hooks/useRetryApnRegistration.ts`

```typescript
'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/helpers/fetcher';
import type { RetryApnRegistration } from '@auto-rfp/core';

export const useRetryApnRegistration = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async (dto: RetryApnRegistration): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiMutate('/apn/retry-registration', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry registration');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { retry, isLoading, error };
};
```

---

### `apps/web/features/apn/components/ApnRegistrationBadge.tsx`

```typescript
'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApnRegistrationStatus } from '@auto-rfp/core';

interface ApnRegistrationBadgeProps {
  status: ApnRegistrationStatus | null | undefined;
  isLoading?: boolean;
  apnOpportunityUrl?: string;
}

const STATUS_CONFIG: Record<
  ApnRegistrationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  PENDING:          { label: 'APN: Pending',        variant: 'secondary' },
  REGISTERED:       { label: 'APN: Registered',     variant: 'default' },
  FAILED:           { label: 'APN: Failed',         variant: 'destructive' },
  RETRYING:         { label: 'APN: Retrying…',      variant: 'secondary' },
  NOT_CONFIGURED:   { label: 'APN: Not Configured', variant: 'outline' },
};

export const ApnRegistrationBadge = ({
  status,
  isLoading,
  apnOpportunityUrl,
}: ApnRegistrationBadgeProps) => {
  if (isLoading) {
    return <Skeleton className="h-5 w-28 rounded-full" />;
  }

  if (!status) return null;

  const config = STATUS_CONFIG[status];

  if (status === 'REGISTERED' && apnOpportunityUrl) {
    return (
      <a href={apnOpportunityUrl} target="_blank" rel="noopener noreferrer">
        <Badge variant={config.variant}>{config.label} ↗</Badge>
      </a>
    );
  }

  return <Badge variant={config.variant}>{config.label}</Badge>;
};
```

---

### `apps/web/features/apn/components/ApnRetryButton.tsx`

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { useRetryApnRegistration } from '../hooks/useRetryApnRegistration';
import type { ApnRegistrationItem } from '@auto-rfp/core';

interface ApnRetryButtonProps {
  registration: ApnRegistrationItem;
  onSuccess?: () => void;
}

export const ApnRetryButton = ({ registration, onSuccess }: ApnRetryButtonProps) => {
  const { retry, isLoading, error } = useRetryApnRegistration();

  if (registration.status !== 'FAILED') return null;

  const handleRetry = async () => {
    const ok = await retry({
      orgId:          registration.orgId,
      projectId:      registration.projectId,
      oppId:          registration.oppId,
      registrationId: registration.registrationId,
    });
    if (ok) onSuccess?.();
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={isLoading}
      >
        {isLoading ? 'Retrying…' : 'Retry APN Registration'}
      </Button>
      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  );
};
```

---

### `apps/web/features/apn/components/ApnCredentialsForm.tsx`

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SaveApnCredentialsSchema } from '@auto-rfp/core';
import type { SaveApnCredentials } from '@auto-rfp/core';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useSaveApnCredentials } from '../hooks/useSaveApnCredentials';
import { useApnCredentials } from '../hooks/useApnCredentials';

interface ApnCredentialsFormProps {
  orgId: string;
  onSaved?: () => void;
}

type FormValues = z.input<typeof SaveApnCredentialsSchema>;

export const ApnCredentialsForm = ({ orgId, onSaved }: ApnCredentialsFormProps) => {
  const { credentials, isLoading: isLoadingCreds, refresh } = useApnCredentials(orgId);
  const { save, isLoading: isSaving, error } = useSaveApnCredentials();

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(SaveApnCredentialsSchema),
    defaultValues: { orgId, region: 'us-east-1' },
  });

  const onSubmit = async (values: FormValues) => {
    const ok = await save(values as SaveApnCredentials);
    if (ok) {
      refresh();
      onSaved?.();
    }
  };

  if (isLoadingCreds) {
    return (
      <Card className="p-6 space-y-3">
        <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="h-9 w-full bg-slate-200 rounded animate-pulse" />
        <div className="h-9 w-full bg-slate-200 rounded animate-pulse" />
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold mb-4">
        AWS Partner Network (APN) Credentials
        {credentials?.configured && (
          <span className="ml-2 text-emerald-600 font-normal text-xs">✓ Configured</span>
        )}
      </h3>

      {credentials?.configured && (
        <p className="text-xs text-slate-500 mb-4">
          Partner ID: <strong>{credentials.partnerId}</strong> · Region: {credentials.region}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <input type="hidden" {...register('orgId')} />

        <div>
          <label className="text-xs font-medium text-slate-700">AWS Partner ID</label>
          <Input
            {...register('partnerId')}
            placeholder="e.g. 0010000000XXXXXX"
            className="mt-1"
          />
          {errors.partnerId && (
            <p className="text-xs text-red-500 mt-1">{errors.partnerId.message}</p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">Access Key ID</label>
          <Input
            {...register('accessKeyId')}
            placeholder="AKIA…"
            className="mt-1"
          />
          {errors.accessKeyId && (
            <p className="text-xs text-red-500 mt-1">{errors.accessKeyId.message}</p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">Secret Access Key</label>
          <Input
            {...register('secretAccessKey')}
            type="password"
            placeholder="••••••••"
            className="mt-1"
          />
          {errors.secretAccessKey && (
            <p className="text-xs text-red-500 mt-1">{errors.secretAccessKey.message}</p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">Region</label>
          <Input
            {...register('region')}
            placeholder="us-east-1"
            className="mt-1"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button type="submit" disabled={isSaving} className="w-full">
          {isSaving ? 'Saving…' : credentials?.configured ? 'Update Credentials' : 'Save Credentials'}
        </Button>
      </form>
    </Card>
  );
};
```

---

### `apps/web/features/apn/index.ts`

```typescript
export { ApnRegistrationBadge } from './components/ApnRegistrationBadge';
export { ApnRetryButton } from './components/ApnRetryButton';
export { ApnCredentialsForm } from './components/ApnCredentialsForm';
export { useApnRegistration } from './hooks/useApnRegistration';
export { useApnCredentials } from './hooks/useApnCredentials';
export { useSaveApnCredentials } from './hooks/useSaveApnCredentials';
export { useRetryApnRegistration } from './hooks/useRetryApnRegistration';
```

---

## 8. Permissions & RBAC <!-- ⏳ PENDING -->

### New Permissions

Add to `packages/core/src/schemas/user.ts`:

```typescript
export const APN_PERMISSIONS = [
  'apn:read',
  'apn:configure',
  'apn:retry',
] as const;

// Add to ALL_PERMISSIONS:
...APN_PERMISSIONS,

// Add to ROLE_PERMISSIONS:
ADMIN: [...ALL_PERMISSIONS],  // already includes everything
EDITOR: [
  // existing...
  'apn:read',
  'apn:retry',
],
VIEWER: [
  // existing...
  'apn:read',
],
```

### Role Matrix

| Permission | ADMIN | EDITOR | VIEWER | BILLING |
|---|---|---|---|---|
| `apn:read` (view registration status) | ✅ | ✅ | ✅ | ❌ |
| `apn:configure` (save credentials) | ✅ | ❌ | ❌ | ❌ |
| `apn:retry` (retry failed registration) | ✅ | ✅ | ❌ | ❌ |

> **Note:** The handlers currently use `org:manage_settings` for credentials (ADMIN-only) and `opportunity:edit` for retry (ADMIN + EDITOR). The dedicated `apn:*` permissions above can be wired in a follow-up once the feature is stable.

---

## 9. CDK Stack Updates <!-- ⏳ PENDING -->

### Infrastructure Summary

| Resource | Type | Notes |
|---|---|---|
| 4 new Lambda functions | `NodejsFunction` | One per APN handler |
| 4 new CloudWatch Log Groups | `logs.LogGroup` | 2-week retention (non-prod), INFINITE (prod) |
| Secrets Manager IAM policy | `PolicyStatement` | Already covered by existing `secretsmanager:*` policy on `*-api-key-*` |
| New API routes | `ApiDomainRoutesStack` | `ApnRoutes` nested stack |

### IAM Additions

The existing Secrets Manager policy in `api-orchestrator-stack.ts` already covers the APN secret pattern (`*-api-key-*`):

```typescript
// Already present — no change needed:
sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: [
      'secretsmanager:GetSecretValue',
      'secretsmanager:PutSecretValue',
      'secretsmanager:DeleteSecret',
      'secretsmanager:CreateSecret',
    ],
    resources: [`arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:*-api-key-*`],
  }),
);
```

The APN secret is stored as `apn-api-key-{orgId}` which matches the existing wildcard pattern.

### Log Groups (add to `api-orchestrator-stack.ts` or the domain nested stack)

```typescript
const apnHandlers = [
  'get-apn-credentials',
  'save-apn-credentials',
  'get-apn-registration',
  'retry-apn-registration',
];

for (const handlerName of apnHandlers) {
  new logs.LogGroup(this, `ApnLogs-${handlerName}-${stage}`, {
    logGroupName: `/aws/lambda/auto-rfp-apn-${handlerName}-${stage}`,
    retention: stage === 'prod'
      ? logs.RetentionDays.INFINITE
      : logs.RetentionDays.TWO_WEEKS,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
}
```

---

## 10. Audit Trail <!-- ⏳ PENDING -->

All APN actions emit audit log entries. Summary:

| Action | Trigger | `result` |
|---|---|---|
| `APN_REGISTRATION_STARTED` | `triggerApnRegistration()` called | `success` |
| `APN_REGISTRATION_COMPLETED` | Partner Central API returns 200 | `success` |
| `APN_REGISTRATION_FAILED` | Partner Central API error or no credentials | `failure` |
| `APN_REGISTRATION_RETRIED` | `retry-apn-registration` handler called | `success` / `failure` |
| `API_KEY_CREATED` | `save-apn-credentials` handler called | `success` |

All audit writes for APN registration are **non-blocking** (`.catch()` pattern) since they are high-frequency and non-critical to the proposal submission flow.

---

## 11. Implementation Tickets <!-- ⏳ PENDING -->

### APN-1 · Core Schemas & Constants (30 min) <!-- ⏳ PENDING -->

**Files to create/modify:**
- `packages/core/src/schemas/apn.ts` ← new
- `packages/core/src/schemas/index.ts` ← add `export * from './apn'`
- `packages/core/src/schemas/audit.ts` ← add 4 new audit actions + `apn_registration` resource
- `apps/functions/src/constants/apn.ts` ← new

**Acceptance criteria:**
- [ ] `ApnRegistrationItemSchema`, `SaveApnCredentialsSchema`, `RetryApnRegistrationSchema` parse valid data
- [ ] `ApnRegistrationStatusSchema` rejects unknown values
- [ ] New audit actions compile without TypeScript errors
- [ ] All types inferred from Zod — no manually defined types

---

### APN-2 · Backend Helper (`apps/functions/src/helpers/apn.ts`) (1.5 h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/functions/src/helpers/apn.ts`

**Acceptance criteria:**
- [ ] `saveApnCredentials()` stores secret in Secrets Manager + metadata in DynamoDB
- [ ] `getApnCredentialsMeta()` returns `{ configured: false }` when no record exists
- [ ] `createApnRegistration()` creates a `PENDING` record in DynamoDB
- [ ] `triggerApnRegistration()` transitions record to `REGISTERED` on success, `FAILED` on error
- [ ] `retryApnRegistration()` throws if status is already `REGISTERED`
- [ ] SK builders produce correct `orgId#projectId#oppId#registrationId` format

---

### APN-3 · Lambda Handlers (1 h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/functions/src/handlers/apn/get-apn-credentials.ts`
- `apps/functions/src/handlers/apn/save-apn-credentials.ts`
- `apps/functions/src/handlers/apn/get-apn-registration.ts`
- `apps/functions/src/handlers/apn/retry-apn-registration.ts`

**Acceptance criteria:**
- [ ] All handlers use `apiResponse()` — no raw response objects
- [ ] `orgId` sourced from query params (GET) or body (POST) — never from token
- [ ] All `safeParse` results destructured immediately
- [ ] Middy middleware stack: `authContextMiddleware → orgMembershipMiddleware → requirePermission → httpErrorMiddleware`
- [ ] `save-apn-credentials` emits `API_KEY_CREATED` audit log (non-blocking)
- [ ] `retry-apn-registration` emits `INTEGRATION_SYNC_FAILED` audit log on error (non-blocking)

---

### APN-4 · Opportunity Stage Hook Integration (45 min) <!-- ⏳ PENDING -->

**Files to modify:**
- `apps/functions/src/helpers/opportunity-stage.ts`

**Acceptance criteria:**
- [ ] `onProjectOutcomeSet()` calls `triggerApnRegistration()` non-blocking when `outcomeStatus === 'PENDING'` (stage → SUBMITTED)
- [ ] If `getOpportunity()` returns null, registration is skipped gracefully
- [ ] No change to existing proposal submission response time (non-blocking)
- [ ] Existing tests for `onProjectOutcomeSet()` still pass

---

### APN-5 · CDK Infrastructure (30 min) <!-- ⏳ PENDING -->

**Files to create/modify:**
- `packages/infra/api/routes/apn.routes.ts` ← new
- `packages/infra/api/api-orchestrator-stack.ts` ← add `apnDomain()` + `'ApnRoutes'`

**Acceptance criteria:**
- [ ] 4 routes registered under `/apn/` base path
- [ ] CloudWatch Log Groups created for all 4 Lambda functions
- [ ] No new IAM policies needed (existing Secrets Manager wildcard covers `apn-api-key-*`)
- [ ] `pnpm run build` in `packages/infra` succeeds

---

### APN-6 · Frontend Feature Module (2 h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/web/features/apn/hooks/useApnRegistration.ts`
- `apps/web/features/apn/hooks/useApnCredentials.ts`
- `apps/web/features/apn/hooks/useSaveApnCredentials.ts`
- `apps/web/features/apn/hooks/useRetryApnRegistration.ts`
- `apps/web/features/apn/components/ApnRegistrationBadge.tsx`
- `apps/web/features/apn/components/ApnRetryButton.tsx`
- `apps/web/features/apn/components/ApnCredentialsForm.tsx`
- `apps/web/features/apn/index.ts`

**Acceptance criteria:**
- [ ] `ApnRegistrationBadge` shows correct color/label for each status
- [ ] `ApnRegistrationBadge` links to Partner Portal when status is `REGISTERED`
- [ ] `ApnRetryButton` only renders when status is `FAILED`
- [ ] `ApnCredentialsForm` uses skeleton loading state (no spinners)
- [ ] `ApnCredentialsForm` uses `react-hook-form` + `zodResolver`
- [ ] All hooks use `authenticatedFetcher`
- [ ] Barrel export from `index.ts`

---

### APN-7 · Wire Components into Existing Pages (1 h) <!-- ⏳ PENDING -->

**Files to modify:**
- Opportunity detail page (wherever proposal status is shown) ← add `ApnRegistrationBadge` + `ApnRetryButton`
- Organization settings page ← add `ApnCredentialsForm`

**Acceptance criteria:**
- [ ] `ApnRegistrationBadge` visible on opportunity/proposal detail when stage is `SUBMITTED`, `WON`, or `LOST`
- [ ] `ApnRetryButton` visible when registration status is `FAILED`
- [ ] `ApnCredentialsForm` accessible from org settings (ADMIN only)
- [ ] No regressions on existing opportunity detail or settings pages

---

### APN-8 · Tests (1.5 h) <!-- ⏳ PENDING -->

**Files to create:**
- `apps/functions/src/helpers/apn.test.ts`
- `apps/functions/src/handlers/apn/get-apn-registration.test.ts`
- `apps/functions/src/handlers/apn/retry-apn-registration.test.ts`
- `packages/core/src/schemas/apn.test.ts`

**Acceptance criteria:**
- [ ] `apn.test.ts`: happy path, credentials not configured, API error → FAILED status
- [ ] `get-apn-registration.test.ts`: returns null when no registration exists, returns latest registration
- [ ] `retry-apn-registration.test.ts`: throws when already REGISTERED, succeeds on retry
- [ ] `apn.test.ts` (core): valid data passes, invalid data fails with correct errors
- [ ] All mocks reset in `beforeEach`

---

## 12. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

- [ ] Proposal submission (stage → SUBMITTED) automatically triggers APN registration
- [ ] Registration is non-blocking — proposal submission response time is unaffected
- [ ] If APN credentials are not configured, registration is silently skipped (no error to user)
- [ ] Registration status (`PENDING`, `REGISTERED`, `FAILED`) visible on proposal/opportunity detail
- [ ] `REGISTERED` status links to the opportunity in AWS Partner Portal
- [ ] Manual retry button visible when status is `FAILED`
- [ ] Retry updates the existing registration record (no duplicate records)
- [ ] APN credentials (Partner ID, Access Key, Secret Key) stored securely in Secrets Manager
- [ ] Non-secret credential metadata (Partner ID, region, configuredAt) stored in DynamoDB
- [ ] Credentials management accessible from org settings (ADMIN only)
- [ ] Full audit log for: credential save, registration attempt, registration success/failure, retry
- [ ] All audit writes are non-blocking (`.catch()` pattern)
- [ ] TypeScript compiles with no errors across all packages
- [ ] All new handlers have corresponding tests

---

## 13. Summary of New Files <!-- ⏳ PENDING -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/apn.ts` | Zod schemas for APN registration, credentials, responses | ⏳ |
| `apps/functions/src/constants/apn.ts` | PK constants and secret prefix | ⏳ |
| `apps/functions/src/helpers/apn.ts` | SK builders, DynamoDB helpers, Partner Central API client, registration logic | ⏳ |
| `apps/functions/src/handlers/apn/get-apn-credentials.ts` | GET /apn/credentials | ⏳ |
| `apps/functions/src/handlers/apn/save-apn-credentials.ts` | POST /apn/credentials | ⏳ |
| `apps/functions/src/handlers/apn/get-apn-registration.ts` | GET /apn/registration | ⏳ |
| `apps/functions/src/handlers/apn/retry-apn-registration.ts` | POST /apn/retry-registration | ⏳ |
| `packages/infra/api/routes/apn.routes.ts` | CDK route definitions for APN domain | ⏳ |
| `apps/web/features/apn/hooks/useApnRegistration.ts` | SWR hook for registration status | ⏳ |
| `apps/web/features/apn/hooks/useApnCredentials.ts` | SWR hook for credentials metadata | ⏳ |
| `apps/web/features/apn/hooks/useSaveApnCredentials.ts` | Mutation hook for saving credentials | ⏳ |
| `apps/web/features/apn/hooks/useRetryApnRegistration.ts` | Mutation hook for retry | ⏳ |
| `apps/web/features/apn/components/ApnRegistrationBadge.tsx` | Status badge component | ⏳ |
| `apps/web/features/apn/components/ApnRetryButton.tsx` | Manual retry button component | ⏳ |
| `apps/web/features/apn/components/ApnCredentialsForm.tsx` | Credentials settings form | ⏳ |
| `apps/web/features/apn/index.ts` | Barrel export | ⏳ |
| `packages/core/src/schemas/apn.test.ts` | Schema unit tests | ⏳ |
| `apps/functions/src/helpers/apn.test.ts` | Helper unit tests | ⏳ |
| `apps/functions/src/handlers/apn/get-apn-registration.test.ts` | Handler unit tests | ⏳ |
| `apps/functions/src/handlers/apn/retry-apn-registration.test.ts` | Handler unit tests | ⏳ |

**Modified Files:**

| File | Change | Status |
|---|---|---|
| `packages/core/src/schemas/index.ts` | Add `export * from './apn'` | ⏳ |
| `packages/core/src/schemas/audit.ts` | Add 4 APN audit actions + `apn_registration` resource | ⏳ |
| `packages/core/src/schemas/user.ts` | Add `APN_PERMISSIONS` + role assignments | ⏳ |
| `apps/functions/src/helpers/opportunity-stage.ts` | Call `triggerApnRegistration()` non-blocking on SUBMITTED | ⏳ |
| `packages/infra/api/api-orchestrator-stack.ts` | Register `apnDomain()` + `'ApnRoutes'` | ⏳ |
