import { GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { createItem, DBItem, docClient, scanByPkWithFilter } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { REQUIRED_FORM_PK } from '../constants/required-form';
import { nowIso } from './date';

import type {
  RequiredFormItem,
  CreateRequiredFormDTO,
  UpdateRequiredFormDTO,
  DetectedFormField,
} from '@auto-rfp/core';

const DOCUMENTS_TABLE = requireEnv('DB_TABLE_NAME');

export type RequiredFormDBItem = RequiredFormItem & DBItem;

export const buildRequiredFormSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string
) => `${orgId}#${projectId}#${opportunityId}#${formId}`;

export const buildRequiredFormSkPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string
) => `${orgId}#${projectId}#${opportunityId}#`;

export const createRequiredForm = async (args: {
  dto: CreateRequiredFormDTO;
  fields?: DetectedFormField[];
}): Promise<{ item: RequiredFormDBItem; formId: string }> => {
  const { dto, fields = [] } = args;
  const formId = uuidv4();

  const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const total = fields.length;

  const item = await createItem<RequiredFormDBItem>(
    REQUIRED_FORM_PK,
    buildRequiredFormSk(dto.orgId, dto.projectId, dto.opportunityId, formId),
    {
      ...dto,
      formId,
      status: total > 0 ? 'READY' : 'NEW',
      fields,
      filledFileKey: null,
      autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
      manualFieldCount: manual,
      totalFieldCount: total,
      reviewRequired: true,
      reviewedBy: null,
      reviewedAt: null,
      errorMessage: null,
    } as unknown as RequiredFormDBItem
  );

  return { item, formId };
};

export const getRequiredForm = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
}): Promise<RequiredFormDBItem | null> => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: REQUIRED_FORM_PK,
        [SK_NAME]: buildRequiredFormSk(args.orgId, args.projectId, args.opportunityId, args.formId),
      },
    })
  );
  return (res.Item as RequiredFormDBItem) ?? null;
};

export const listRequiredFormsByOpportunity = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
}): Promise<RequiredFormDBItem[]> => {
  const skPrefix = buildRequiredFormSkPrefix(args.orgId, args.projectId, args.opportunityId);

  const res = await docClient.send(
    new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': REQUIRED_FORM_PK, ':skPrefix': skPrefix },
      ScanIndexForward: false,
    })
  );

  return (res.Items ?? []) as RequiredFormDBItem[];
};

export const updateRequiredForm = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
  patch: UpdateRequiredFormDTO & { fields?: DetectedFormField[] };
}): Promise<RequiredFormDBItem> => {
  const forbidden = new Set(['partition_key', 'sort_key', 'createdAt', 'updatedAt', 'formId', 'orgId', 'projectId', 'opportunityId']);
  const patchEntries = Object.entries(args.patch).filter(
    ([k, v]) => !forbidden.has(k) && typeof v !== 'undefined'
  );

  const names: Record<string, string> = { '#pk': PK_NAME, '#sk': SK_NAME, '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':u': nowIso() };
  const updates: string[] = [];

  for (const [k, v] of patchEntries) {
    names[`#f_${k}`] = k;
    values[`:v_${k}`] = v;
    updates.push(`#f_${k} = :v_${k}`);
  }
  updates.push('#updatedAt = :u');

  const res = await docClient.send(
    new UpdateCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: REQUIRED_FORM_PK,
        [SK_NAME]: buildRequiredFormSk(args.orgId, args.projectId, args.opportunityId, args.formId),
      },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as RequiredFormDBItem;
};

export const findRequiredFormByFormId = async (formId: string): Promise<RequiredFormDBItem | null> => {
  const items = await scanByPkWithFilter<RequiredFormDBItem>(REQUIRED_FORM_PK, 'formId', formId);
  return items[0] ?? null;
};

export const deleteRequiredForm = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
}): Promise<void> => {
  await docClient.send(
    new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: REQUIRED_FORM_PK,
        [SK_NAME]: buildRequiredFormSk(args.orgId, args.projectId, args.opportunityId, args.formId),
      },
    })
  );
};
