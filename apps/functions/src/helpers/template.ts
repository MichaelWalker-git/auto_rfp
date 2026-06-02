import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getItem } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { createTemplateSK, TEMPLATE_PK, type TemplateItem } from '@auto-rfp/core';
import { loadTextFromS3, uploadToS3 } from './s3';
import { nowIso } from './date';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

export const putTemplate = async (item: TemplateItem): Promise<void> => {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...item,
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(item.orgId, item.id),
    },
  }));
};

export const getTemplate = async (orgId: string, templateId: string,) =>
  getItem<TemplateItem>(TEMPLATE_PK, createTemplateSK(orgId, templateId));

export const listTemplatesByOrg = async (
  orgId: string,
  options?: {
    category?: string;
    status?: string;
    excludeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: TemplateItem[]; total: number }> => {
  const filterExpressions: string[] = [];
  const exprAttrNames: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
  };
  const exprAttrValues: Record<string, unknown> = {
    ':pk': TEMPLATE_PK,
    ':skPrefix': `${orgId}#`,
  };

  if (options?.excludeArchived !== false) {
    filterExpressions.push('(attribute_not_exists(#isArchived) OR #isArchived = :false)');
    exprAttrNames['#isArchived'] = 'isArchived';
    exprAttrValues[':false'] = false;
  }

  if (options?.category) {
    filterExpressions.push('#category = :category');
    exprAttrNames['#category'] = 'category';
    exprAttrValues[':category'] = options.category;
  }

  if (options?.status) {
    filterExpressions.push('#status = :status');
    exprAttrNames['#status'] = 'status';
    exprAttrValues[':status'] = options.status;
  }

  const res = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    FilterExpression: filterExpressions.length > 0
      ? filterExpressions.join(' AND ')
      : undefined,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
  }));

  const allItems = (res.Items as TemplateItem[]) ?? [];
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 20;
  const paged = allItems.slice(offset, offset + limit);

  return { items: paged, total: allItems.length };
};

export const updateTemplateFields = async (
  orgId: string,
  templateId: string,
  updates: Record<string, unknown>,
): Promise<void> => {
  const updateParts: string[] = [];
  const exprAttrNames: Record<string, string> = {};
  const exprAttrValues: Record<string, unknown> = {};

  Object.entries(updates).forEach(([key, value], idx) => {
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    updateParts.push(`${nameKey} = ${valueKey}`);
    exprAttrNames[nameKey] = key;
    exprAttrValues[valueKey] = value;
  });

  if (updateParts.length === 0) return;

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(orgId, templateId),
    },
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
  }));
};

/**
 * Build the S3 key for a template's HTML content.
 */
export const buildTemplateHtmlKey = (orgId: string, templateId: string): string =>
  `templates/${orgId}/${templateId}/content.html`;

/**
 * Upload raw HTML content to S3 and return the S3 key.
 */
export const uploadTemplateHtml = async (
  orgId: string,
  templateId: string,
  html: string,
): Promise<string> => {
  const key = buildTemplateHtmlKey(orgId, templateId);
  await uploadToS3(DOCUMENTS_BUCKET, key, html, 'text/html');
  return key;
};

/**
 * Load raw HTML content from S3 for a template.
 */
export const loadTemplateHtml = async (htmlContentKey: string): Promise<string> =>
  loadTextFromS3(DOCUMENTS_BUCKET, htmlContentKey);

// ================================
// Template Selection
// ================================

/**
 * Find the best template for a given org and document category.
 * Prefers the default template, then PUBLISHED over DRAFT, then most recently updated.
 * Returns null if no matching template is found.
 */
export const findBestTemplate = async (
  orgId: string,
  category: string,
): Promise<TemplateItem | null> => {
  const { items: allItems } = await listTemplatesByOrg(orgId, {
    category,
    excludeArchived: true,
    limit: 50,
  });

  if (allItems.length === 0) return null;

  // Sort: default first, then PUBLISHED, then by updatedAt descending (most recent first)
  const sorted = [...allItems].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (b.isDefault && !a.isDefault) return 1;
    if (a.status === 'PUBLISHED' && b.status !== 'PUBLISHED') return -1;
    if (b.status === 'PUBLISHED' && a.status !== 'PUBLISHED') return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const best = sorted[0]!;
  console.log(`Selected template for ${category}: "${best.name}" (${best.status}, isDefault: ${best.isDefault ?? false}, updated: ${best.updatedAt})`);
  return best;
};

/**
 * Clear the default marker from every template in a category for an org,
 * optionally skipping one template id (the one being newly marked).
 * Returns the ids that were cleared.
 */
export const clearDefaultForCategory = async (
  orgId: string,
  category: string,
  exceptTemplateId?: string,
): Promise<string[]> => {
  const { items } = await listTemplatesByOrg(orgId, {
    category,
    excludeArchived: false,
    limit: 50,
  });

  const toClear = items.filter(
    (t) => t.isDefault && t.id !== exceptTemplateId,
  );

  await Promise.all(
    toClear.map((t) =>
      updateTemplateFields(orgId, t.id, { isDefault: false, updatedAt: nowIso() }),
    ),
  );

  return toClear.map((t) => t.id);
};

/**
 * Mark a template as the default template for its category.
 * Enforces one default template per category per org by clearing any
 * previously marked template in the same category first.
 */
export const setDefaultTemplate = async (
  orgId: string,
  templateId: string,
  category: string,
): Promise<void> => {
  await clearDefaultForCategory(orgId, category, templateId);
  await updateTemplateFields(orgId, templateId, {
    isDefault: true,
    updatedAt: nowIso(),
  });
};

// ================================
// Macro Engine
// ================================

export const replaceMacros = (
  text: string,
  macroValues: Record<string, string>,
  options: { removeUnresolved?: boolean } = {},
): string =>
  text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in macroValues) return macroValues[key];
    return options.removeUnresolved ? '' : match;
  });