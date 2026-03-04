import { v4 as uuidv4 } from 'uuid';
import { SignatureV4 } from '@smithy/signature-v4';
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
import type {
  ApnRegistrationItem,
  AwsService,
  CreateApnRegistration,
  SaveApnCredentials,
  GetApnCredentialsResponse,
} from '@auto-rfp/core';

requireEnv('DB_TABLE_NAME');

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

interface ApnSecretKeys {
  accessKeyId: string;
  secretAccessKey: string;
}

interface ApnCredentialsMeta {
  orgId: string;
  partnerId: string;
  region: string;
  configuredAt: string;
}

export const saveApnCredentials = async (dto: SaveApnCredentials): Promise<void> => {
  const { orgId, partnerId, accessKeyId, secretAccessKey, region } = dto;

  // Store sensitive keys in Secrets Manager
  const secretValue = JSON.stringify({ accessKeyId, secretAccessKey });
  await storeApiKey(orgId, APN_SECRET_PREFIX, secretValue);

  // Store non-secret metadata in DynamoDB for quick lookup
  await putItem<ApnCredentialsMeta>(
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
  const meta = await getItem<ApnCredentialsMeta>(
    APN_CREDENTIALS_PK,
    buildApnCredentialsSk(orgId),
  );

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
): Promise<ApnSecretKeys | null> => {
  const raw = await getApiKey(orgId, APN_SECRET_PREFIX);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ApnSecretKeys;
  } catch {
    return null;
  }
};

// ─── Partner Central API Client ───────────────────────────────────────────────

interface ApnOpportunityPayload {
  partnerId:         string;
  customerName:      string;
  opportunityValue:  number;
  awsServices:       string[];
  expectedCloseDate: string;
  proposalStatus:    string;
  description?:      string;
  externalId:        string; // our registrationId — idempotency key
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

  const item = await createItem<ApnRegistrationItem>(
    APN_REGISTRATION_PK,
    buildApnRegistrationSk(dto.orgId, dto.projectId, dto.oppId, registrationId),
    {
      ...dto,
      registrationId,
      status: 'PENDING',
      retryCount: 0,
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
  // Use putItem with preserveCreatedAt=true to merge patch fields without overwriting createdAt
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...patchWithoutTimestamps } = patch;
  await putItem(
    APN_REGISTRATION_PK,
    buildApnRegistrationSk(orgId, projectId, oppId, registrationId),
    {
      ...patchWithoutTimestamps,
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

export interface TriggerApnRegistrationArgs {
  orgId:             string;
  projectId:         string;
  oppId:             string;
  customerName:      string;
  opportunityValue:  number;
  awsServices:       AwsService[];
  expectedCloseDate: string;
  proposalStatus:    'SUBMITTED' | 'WON' | 'LOST';
  description?:      string;
  registeredBy:      string;
}

/**
 * Registers an opportunity in the AWS Partner Portal.
 * Creates a registration record, calls the Partner Central API,
 * and updates the record with the result.
 *
 * Designed to be called non-blocking from onProjectOutcomeSet().
 */
export const triggerApnRegistration = async (
  args: TriggerApnRegistrationArgs,
): Promise<void> => {
  const {
    orgId, projectId, oppId, customerName, opportunityValue,
    awsServices, expectedCloseDate, proposalStatus, description, registeredBy,
  } = args;

  // Check credentials first — if not configured, skip silently
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
    awsServices,
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

export interface RetryApnRegistrationArgs {
  orgId:          string;
  projectId:      string;
  oppId:          string;
  registrationId: string;
  retriedBy:      string;
}

/**
 * Retries a failed APN registration.
 * Updates the existing record's status to RETRYING, then attempts the API call.
 */
export const retryApnRegistration = async (
  args: RetryApnRegistrationArgs,
): Promise<ApnRegistrationItem> => {
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
      partnerId:         meta.partnerId!,
      customerName:      existing.customerName,
      opportunityValue:  existing.opportunityValue,
      awsServices:       existing.awsServices,
      expectedCloseDate: existing.expectedCloseDate,
      proposalStatus:    existing.proposalStatus,
      description:       existing.description,
      externalId:        registrationId,
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
