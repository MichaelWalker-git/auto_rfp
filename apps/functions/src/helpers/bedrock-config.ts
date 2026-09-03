/**
 * bedrock-config.ts
 *
 * Domain helpers for the per-org Bedrock configuration (the NON-SECRET half).
 * The Bedrock Bearer key itself is stored in Secrets Manager via
 * `storeApiKey`/`getApiKey` (prefix `bedrock`); this file only reads/writes the
 * queryable DynamoDB config (fallback model + last probe result).
 *
 * SK is simply the orgId — one config per org (mirrors company-profile.ts).
 */
import { DBItem, docClient, getItem, putItem } from './db';
import { requireEnv } from './env';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { BEDROCK_CONFIG_PK } from '../constants/bedrock-config';
import type { BedrockConfigItem, BedrockProbeResult } from '@auto-rfp/core';

const DOCUMENTS_TABLE = requireEnv('DB_TABLE_NAME');

export type BedrockConfigDBItem = BedrockConfigItem & DBItem;

/** SK builder — one config per org. */
export const buildBedrockConfigSk = (orgId: string): string => orgId;

/** Read the non-secret Bedrock config for an org (null if none). */
export const getBedrockConfig = async (orgId: string): Promise<BedrockConfigDBItem | null> =>
  getItem<BedrockConfigDBItem>(BEDROCK_CONFIG_PK, buildBedrockConfigSk(orgId));

/** Upsert the non-secret Bedrock config for an org. */
export const upsertBedrockConfig = async (args: {
  orgId: string;
  fallbackModelId?: string;
  lastProbe?: BedrockProbeResult;
}): Promise<BedrockConfigDBItem> => {
  const { orgId, fallbackModelId, lastProbe } = args;
  return putItem<BedrockConfigDBItem>(
    BEDROCK_CONFIG_PK,
    buildBedrockConfigSk(orgId),
    { id: orgId, orgId, fallbackModelId, lastProbe } as unknown as BedrockConfigDBItem,
    true,
  );
};

/** Delete the non-secret Bedrock config for an org. */
export const deleteBedrockConfig = async (orgId: string): Promise<void> => {
  await docClient.send(
    new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: { [PK_NAME]: BEDROCK_CONFIG_PK, [SK_NAME]: buildBedrockConfigSk(orgId) },
    }),
  );
};
