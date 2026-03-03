/**
 * Custom Document Types — DynamoDB helpers.
 *
 * Stores org-specific document types discovered by AI during brief generation.
 * PK = CUSTOM_DOC_TYPE, SK = {orgId}#{slug}
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import { PK_NAME, SK_NAME } from '../constants/common';
import { CUSTOM_DOC_TYPE_PK } from '../constants/rfp-document';
import { RFPDocumentTypeSchema } from '@auto-rfp/core';
import type { CustomDocumentType, RequiredOutputDocument } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/** Convert a human-readable name to a slug (e.g., "Oral Presentation Plan" → "ORAL_PRESENTATION_PLAN") */
const toSlug = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

/** Check if a documentType string is a standard built-in type */
const isBuiltInType = (documentType: string): boolean =>
  RFPDocumentTypeSchema.safeParse(documentType).success;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Upsert a custom document type for an org.
 * If the slug already exists, updates the name/description.
 */
export const saveCustomDocumentType = async (
  orgId: string,
  name: string,
  description?: string | null,
  isAiDiscovered = true,
): Promise<CustomDocumentType> => {
  const slug = toSlug(name);
  const now = nowIso();

  const item: Record<string, unknown> = {
    [PK_NAME]: CUSTOM_DOC_TYPE_PK,
    [SK_NAME]: `${orgId}#${slug}`,
    orgId,
    slug,
    name,
    description: description ?? null,
    isAiDiscovered,
    createdAt: now,
    updatedAt: now,
  };

  // Unconditional upsert — always overwrite with latest name/description
  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  console.log(`Saved custom document type: orgId=${orgId}, slug=${slug}, name="${name}"`);
  return { orgId, slug, name, description: description ?? null, isAiDiscovered, createdAt: now, updatedAt: now };
};

/**
 * List all custom document types for an org.
 */
export const listCustomDocumentTypes = async (orgId: string): Promise<CustomDocumentType[]> => {
  const items: CustomDocumentType[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': CUSTOM_DOC_TYPE_PK,
          ':skPrefix': `${orgId}#`,
        },
        ExclusiveStartKey,
      }),
    );
    if (res.Items?.length) {
      items.push(...(res.Items as CustomDocumentType[]));
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return items;
};

// ─── AI sync ──────────────────────────────────────────────────────────────────

/**
 * After requirements generation, scan requiredDocuments for any types not in
 * the standard enum and save them as custom types for the org.
 *
 * Called automatically by exec-brief-worker after runRequirements completes.
 */
export const syncRequiredDocumentsToCustomTypes = async (
  orgId: string,
  requiredDocuments: RequiredOutputDocument[],
): Promise<void> => {
  if (!orgId || !requiredDocuments?.length) return;

  const newTypes = requiredDocuments.filter(doc => {
    // Skip standard built-in types and 'OTHER' (too generic)
    if (doc.documentType === 'OTHER') return false;
    if (isBuiltInType(doc.documentType)) return false;
    // Only save if it has a meaningful name different from the slug
    return doc.name?.trim().length > 0;
  });

  if (!newTypes.length) {
    console.log(`syncRequiredDocumentsToCustomTypes: no new custom types for orgId=${orgId}`);
    return;
  }

  console.log(`syncRequiredDocumentsToCustomTypes: saving ${newTypes.length} new custom type(s) for orgId=${orgId}`);

  await Promise.all(
    newTypes.map(doc =>
      saveCustomDocumentType(orgId, doc.name, doc.description, true).catch(err =>
        console.warn(`Failed to save custom doc type "${doc.name}":`, (err as Error)?.message),
      ),
    ),
  );
};
