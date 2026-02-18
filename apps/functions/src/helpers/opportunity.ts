import { GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { createItem, DBItem, docClient } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { OPPORTUNITY_PK } from '../constants/opportunity';
import { safeSplit } from './safe-string';

import type { OpportunityItem } from '@auto-rfp/core';
import { nowIso } from './date';

const DOCUMENTS_TABLE = requireEnv('DB_TABLE_NAME');

export const buildOpportunitySk = (orgId: string, projectId: string, oppId: string) => `${orgId}#${projectId}#${oppId}`;

export const parseOpportunitySk = (sk: string) => {
  const parts = safeSplit(sk, '#');
  return {
    orgId: parts[0] ?? '',
    projectId: parts[1] ?? '',
    oppId: parts[2] ?? '',
  };
};

export type OpportunityDBItem = OpportunityItem & DBItem;

/**
 * CREATE
 * PK: OPPORTUNITY_PK
 * SK: `${orgId}#${projectId}#${oppId}`
 */
export const createOpportunity = async (args: { orgId: string; projectId: string; opportunity: OpportunityItem }) => {
  const oppId = uuidv4();

  const item = await createItem<OpportunityDBItem>(
    OPPORTUNITY_PK,
    buildOpportunitySk(args.orgId, args.projectId, oppId),
    {
      ...args.opportunity,
      oppId,
    } as any
  );

  return { item, oppId };
};

/**
 * READ (by oppId)
 */
export const getOpportunity = async (args: { orgId: string; projectId: string; oppId: string }) => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: OPPORTUNITY_PK,
        [SK_NAME]: buildOpportunitySk(args.orgId, args.projectId, args.oppId),
      },
    }),
  );

  const item = (res.Item as OpportunityDBItem | undefined) ?? undefined;
  return item ? { item, oppId: args.oppId } : undefined;
};

/**
 * LIST (by project)
 * PK = OPPORTUNITY_PK
 * SK begins_with `${orgId}#${projectId}#`
 */
export const listOpportunitiesByProject = async (args: {
  orgId: string;
  projectId: string;
  limit?: number;
  nextToken?: Record<string, any>; // LastEvaluatedKey
}) => {
  const skPrefix = `${args.orgId}#${args.projectId}#`;

  const res = await docClient.send(
    new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: `#pk = :pk AND begins_with(#sk, :skPrefix)`,
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': OPPORTUNITY_PK,
        ':skPrefix': skPrefix,
      },
      Limit: args.limit,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    }),
  );

  const items = (res.Items as OpportunityDBItem[]) ?? [];

  return {
    items,
    nextToken: res.LastEvaluatedKey ?? null,
  };
};

/**
 * UPDATE (partial)
 * Only allows patching OpportunityItem fields (plus bumps updatedAt).
 * For safety, PK/SK/createdAt/updatedAt are not patchable.
 */
export const updateOpportunity = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  patch: Partial<OpportunityItem>;
}) => {
  const forbidden = new Set<string>([PK_NAME, SK_NAME, 'createdAt', 'updatedAt']);
  const patchEntries = Object.entries(args.patch).filter(([k, v]) => !forbidden.has(k) && typeof v !== 'undefined');

  const names: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, any> = {
    ':u': nowIso(),
  };

  const updates: string[] = [];

  for (const [k, v] of patchEntries) {
    const nameKey = `#f_${k}`;
    const valueKey = `:v_${k}`;

    names[nameKey] = k;
    values[valueKey] = v;

    updates.push(`${nameKey} = ${valueKey}`);
  }

  updates.push('#updatedAt = :u');

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: OPPORTUNITY_PK,
        [SK_NAME]: buildOpportunitySk(args.orgId, args.projectId, args.oppId),
      },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: `attribute_exists(#pk) AND attribute_exists(#sk)`,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return { item: res.Attributes as OpportunityDBItem, oppId: args.oppId };
};

/**
 * DELETE
 */
export const deleteOpportunity = async (args: { orgId: string; projectId: string; oppId: string }) => {
  await docClient.send(
    new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: OPPORTUNITY_PK,
        [SK_NAME]: buildOpportunitySk(args.orgId, args.projectId, args.oppId),
      },
      ConditionExpression: `attribute_exists(#pk) AND attribute_exists(#sk)`,
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
    }),
  );

  return { ok: true as const };
};