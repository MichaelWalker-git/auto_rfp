import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { createTemplateSK, TEMPLATE_PK, type TemplateItem, type TemplateSection, } from '@auto-rfp/core';
import { loadTextFromS3, uploadToS3 } from './s3';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ================================
// S3 Key Builders
// ================================

export const buildTemplateS3Key = (
  orgId: string,
  templateId: string,
  version: number,
): string =>
  `templates/${orgId}/${templateId}/v${version}/content.json`;

export const buildGlobalTemplateS3Key = (
  templateId: string,
  version: number,
): string =>
  `templates/global/${templateId}/v${version}/content.json`;

// ================================
// DynamoDB Operations
// ================================

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

export const getTemplate = async (
  orgId: string,
  templateId: string,
): Promise<TemplateItem | null> => {
  const res = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(orgId, templateId),
    },
  }));
  return (res.Item as TemplateItem) ?? null;
};

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

// ================================
// S3 Version Operations
// ================================

export const saveTemplateVersion = async (
  orgId: string,
  templateId: string,
  version: number,
  content: { sections: TemplateSection[]; macros: unknown[]; styling?: unknown },
): Promise<string> => {
  const s3Key = buildTemplateS3Key(orgId, templateId, version);
  await uploadToS3(
    DOCUMENTS_BUCKET,
    s3Key,
    JSON.stringify(content),
    'application/json',
  );
  return s3Key;
};

export const loadTemplateVersion = async (
  orgId: string,
  templateId: string,
  version: number,
): Promise<{ sections: TemplateSection[]; macros: unknown[]; styling?: unknown } | null> => {
  const s3Key = buildTemplateS3Key(orgId, templateId, version);
  const text = await loadTextFromS3(DOCUMENTS_BUCKET, s3Key);
  if (!text) return null;
  return JSON.parse(text);
};

// ================================
// HTML Content S3 Helpers
// ================================

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