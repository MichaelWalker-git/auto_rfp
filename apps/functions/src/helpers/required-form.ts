import { gzipSync, gunzipSync } from 'node:zlib';

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

// ─── Field compression ───────────────────────────────────────────────────────
//
// A single required-form item stores its whole `fields` array inline. Large
// multi-sheet XLSX compliance matrices produce hundreds–thousands of fields —
// each duplicating the feature text (`label` + `matrixFeature`) plus autofilled
// comment sentences — which pushes the item past DynamoDB's hard 400 KB limit
// and fails the write with "Item size to update has exceeded the maximum
// allowed size".
//
// The `fields` JSON is highly repetitive (repeated feature text, shared column
// headers, many nulls), so gzip shrinks it ~8–15×. We store the compressed
// bytes in a binary `fieldsGz` attribute and keep the inline `fields` array
// empty; reads transparently decompress. Legacy items written before this
// change have no `fieldsGz` and are read straight from inline `fields`.

const FIELDS_GZ_ATTR = 'fieldsGz';

// DynamoDB's hard item limit is 400 KB. Leave headroom for the rest of the
// item (ids, counts, timestamps, error messages) so a form that still overflows
// after compression fails with a clear message instead of the raw DDB error.
const MAX_FIELDS_GZ_BYTES = 380_000;

// Stored shape: the domain item plus the internal compressed-fields attribute.
type StoredRequiredForm = RequiredFormDBItem & { [FIELDS_GZ_ATTR]?: Uint8Array };

const encodeFields = (fields: DetectedFormField[]): Uint8Array => {
  const gz = gzipSync(Buffer.from(JSON.stringify(fields), 'utf-8'));
  if (gz.byteLength > MAX_FIELDS_GZ_BYTES) {
    throw new Error(
      `Compressed form fields (${gz.byteLength} bytes) exceed the DynamoDB item budget ` +
        `(${MAX_FIELDS_GZ_BYTES} bytes); form has ${fields.length} fields`,
    );
  }
  return new Uint8Array(gz);
};

const decodeFields = (raw: Uint8Array): DetectedFormField[] => {
  const json = gunzipSync(raw).toString('utf-8');
  return JSON.parse(json) as DetectedFormField[];
};

/**
 * Reconstruct a domain form item from its stored shape: decompress `fieldsGz`
 * into `fields` (falling back to inline `fields` for legacy items) and drop the
 * internal `fieldsGz` attribute so callers never see it.
 */
function decodeStoredForm(item: StoredRequiredForm): RequiredFormDBItem;
function decodeStoredForm(item: StoredRequiredForm | null | undefined): RequiredFormDBItem | null;
function decodeStoredForm(item: StoredRequiredForm | null | undefined): RequiredFormDBItem | null {
  if (!item) return null;
  const { [FIELDS_GZ_ATTR]: gz, ...rest } = item;
  const fields = gz != null ? decodeFields(gz) : (rest.fields ?? []);
  return { ...rest, fields };
}

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

  const stored = await createItem<StoredRequiredForm>(
    REQUIRED_FORM_PK,
    buildRequiredFormSk(dto.orgId, dto.projectId, dto.opportunityId, formId),
    {
      ...dto,
      formId,
      status: total > 0 ? 'READY' : 'NEW',
      // Fields live in the compressed `fieldsGz` attribute; keep inline `fields`
      // empty so the item stays under the DynamoDB 400 KB limit.
      fields: [],
      [FIELDS_GZ_ATTR]: encodeFields(fields),
      filledFileKey: null,
      autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
      manualFieldCount: manual,
      totalFieldCount: total,
      // Only matrix forms surface a "Review Required" banner. The detect-
      // required-forms handler flips this to true for XLSX_MATRIX; everything
      // else starts false so the schema default and the UI agree.
      reviewRequired: false,
      reviewedBy: null,
      reviewedAt: null,
      errorMessage: null,
    } as unknown as StoredRequiredForm
  );

  return { item: decodeStoredForm(stored), formId };
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
  return decodeStoredForm(res.Item as StoredRequiredForm | undefined);
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

  return ((res.Items ?? []) as StoredRequiredForm[]).map((i) => decodeStoredForm(i));
};

export const updateRequiredForm = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
  patch: UpdateRequiredFormDTO & { fields?: DetectedFormField[] };
  /**
   * When true, the update only succeeds if the form does not already have a
   * proposalDocumentId. Used by the auto-attach paths (save-form-fields,
   * attach-form-to-proposal) so two concurrent requests can't both create a
   * bridge RFP doc and leave one orphaned.
   */
  requireUnattached?: boolean;
  /**
   * When true, the update only succeeds if `notarySource` is AI_DETECTED (or
   * absent). Guards the notary-detection re-run/callback writes (u2 WF-C /
   * BR12.2) so a concurrent USER_SET override is never clobbered — the write
   * condition IS the guard, so there is no read-check-write race. A rejected
   * write throws ConditionalCheckFailedException (callers detect it via
   * `isConditionalCheckFailed`).
   */
  guardNotaryAiDetected?: boolean;
}): Promise<RequiredFormDBItem> => {
  const forbidden = new Set(['partition_key', 'sort_key', 'createdAt', 'updatedAt', 'formId', 'orgId', 'projectId', 'opportunityId']);
  const patchEntries = Object.entries(args.patch).filter(
    ([k, v]) => !forbidden.has(k) && typeof v !== 'undefined'
  );

  const names: Record<string, string> = { '#pk': PK_NAME, '#sk': SK_NAME, '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':u': nowIso() };
  const updates: string[] = [];

  for (const [k, v] of patchEntries) {
    // `fields` is never written inline — compress it into the binary `fieldsGz`
    // attribute so a large matrix doesn't blow the DynamoDB 400 KB item limit.
    if (k === 'fields') {
      names['#f_fields'] = 'fields';
      values[':v_fields'] = [];
      updates.push('#f_fields = :v_fields');
      names[`#f_${FIELDS_GZ_ATTR}`] = FIELDS_GZ_ATTR;
      values[`:v_${FIELDS_GZ_ATTR}`] = encodeFields(v as DetectedFormField[]);
      updates.push(`#f_${FIELDS_GZ_ATTR} = :v_${FIELDS_GZ_ATTR}`);
      continue;
    }
    names[`#f_${k}`] = k;
    values[`:v_${k}`] = v;
    updates.push(`#f_${k} = :v_${k}`);
  }
  updates.push('#updatedAt = :u');

  let conditionExpression = 'attribute_exists(#pk) AND attribute_exists(#sk)';
  if (args.requireUnattached) {
    names['#f_proposalDocumentId'] = 'proposalDocumentId';
    values[':null'] = null;
    conditionExpression += ' AND (attribute_not_exists(#f_proposalDocumentId) OR #f_proposalDocumentId = :null)';
  }
  if (args.guardNotaryAiDetected) {
    // Only overwrite AI-owned notary state — a USER_SET override rejects the
    // write atomically (u2 WF-C / BR12.2). #f_notarySource may already be seeded
    // by a notarySource patch entry above; re-adding the same mapping is a no-op.
    names['#f_notarySource'] = 'notarySource';
    values[':notaryAiDetected'] = 'AI_DETECTED';
    conditionExpression +=
      ' AND (attribute_not_exists(#f_notarySource) OR #f_notarySource = :notaryAiDetected)';
  }

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
      ConditionExpression: conditionExpression,
      ReturnValues: 'ALL_NEW',
    })
  );

  return decodeStoredForm(res.Attributes as StoredRequiredForm);
};

export const findRequiredFormByFormId = async (formId: string): Promise<RequiredFormDBItem | null> => {
  const items = await scanByPkWithFilter<StoredRequiredForm>(REQUIRED_FORM_PK, 'formId', formId);
  return decodeStoredForm(items[0]);
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
