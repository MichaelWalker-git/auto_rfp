import { v4 as uuidv4 } from 'uuid';
import { createItem, putItem, getItem, queryBySkPrefix } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { getApiKey, storeApiKey } from '@/helpers/api-key-storage';
import {
  APN_REGISTRATION_PK,
  APN_SECRET_PREFIX,
  APN_CREDENTIALS_PK,
} from '@/constants/apn';
import type {
  ApnRegistrationItem,
  CreateApnRegistration,
  GetApnCredentialsResponse,
} from '@auto-rfp/core';

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

export const saveApnCredentials = async (dto: {
  orgId: string;
  partnerId: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}): Promise<void> => {
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

export const getApnSecretKeys = async (
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
