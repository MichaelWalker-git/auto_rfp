import { deleteItem, docClient, getItem } from './db';
import { requireEnv } from './env';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { nowIso } from './date';
import { SYSTEM_PROMPT_PK, USER_PROMPT_PK } from '../constants/prompt';
import { DocumentPromptItem, DocumentPromptType, PromptItem, PromptScope, PromptType } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/** Namespace segment for document-generation prompt overrides. */
const DOCUMENT_PROMPT_SK_SEGMENT = 'RFP_DOCUMENT';

const buildFeaturePromptSk = (orgId: string, type: PromptType) => `${orgId}#${type}`;

/**
 * SK for a per-document-type prompt override: `{orgId}#RFP_DOCUMENT#{documentType}`.
 * Three segments — never collides with 2-segment legacy feature SKs like `{orgId}#RFP_DOCUMENT`.
 */
export const buildDocumentPromptSk = (orgId: string, documentType: DocumentPromptType) =>
  `${orgId}#${DOCUMENT_PROMPT_SK_SEGMENT}#${documentType}`;

const promptPkForScope = (scope: PromptScope) =>
  scope === 'SYSTEM' ? SYSTEM_PROMPT_PK : USER_PROMPT_PK;

const savePrompt = async (orgId: string, type: PromptType, prompt: string, pk: string,   params: string[] = []) => {
  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: buildFeaturePromptSk(orgId, type),
      },
      UpdateExpression:
        'SET #prompt = :p, #updatedAt = :u, #orgId = if_not_exists(#orgId, :orgId), #type = if_not_exists(#type, :type), #createdAt = if_not_exists(#createdAt, :u), #params = :params',
      ExpressionAttributeNames: {
        '#prompt': 'prompt',
        '#params': 'params',
        '#updatedAt': 'updatedAt',
        '#createdAt': 'createdAt',
        '#orgId': 'orgId',
        '#type': 'type',
      },
      ExpressionAttributeValues: {
        ':p': String(prompt),
        ':params': params,
        ':u': nowIso(),
        ':orgId': orgId,
        ':type': type,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes;
};

export const saveSystemPrompt = async (orgId: string, type: PromptType, prompt: string, params: string[] = []) => {
  return await savePrompt(orgId, type, prompt, SYSTEM_PROMPT_PK, params);
};

export const saveUserPrompt = async (orgId: string, type: PromptType, prompt: string, params: string[] = []) => {
  return await savePrompt(orgId, type, prompt, USER_PROMPT_PK, params);
};

const readPrompt = async (orgId: string, type: PromptType, pk: string): Promise<PromptItem | null> => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: buildFeaturePromptSk(orgId, type),
      },
      ConsistentRead: false,
    }),
  );

  return (res.Item as PromptItem | undefined) ?? null;
};

export const readSystemPrompt = async (orgId: string, type: PromptType) => {
  return await readPrompt(orgId, type, SYSTEM_PROMPT_PK);
};

export const readUserPrompt = async (orgId: string, type: PromptType) => {
  return await readPrompt(orgId, type, USER_PROMPT_PK);
};

export const saveDocumentPrompt = async (
  orgId: string,
  scope: PromptScope,
  documentType: DocumentPromptType,
  prompt: string,
) => {
  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: promptPkForScope(scope),
        [SK_NAME]: buildDocumentPromptSk(orgId, documentType),
      },
      UpdateExpression:
        'SET #prompt = :p, #updatedAt = :u, #orgId = if_not_exists(#orgId, :orgId), #documentType = if_not_exists(#documentType, :documentType), #scope = if_not_exists(#scope, :scope), #createdAt = if_not_exists(#createdAt, :u)',
      ExpressionAttributeNames: {
        '#prompt': 'prompt',
        '#updatedAt': 'updatedAt',
        '#createdAt': 'createdAt',
        '#orgId': 'orgId',
        '#documentType': 'documentType',
        '#scope': 'scope',
      },
      ExpressionAttributeValues: {
        ':p': String(prompt),
        ':u': nowIso(),
        ':orgId': orgId,
        ':documentType': documentType,
        ':scope': scope,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return res.Attributes;
};

export const readDocumentPrompt = async (
  orgId: string,
  scope: PromptScope,
  documentType: DocumentPromptType,
): Promise<DocumentPromptItem | null> => {
  return await getItem<DocumentPromptItem>(
    promptPkForScope(scope),
    buildDocumentPromptSk(orgId, documentType),
  );
};

export const deleteDocumentPrompt = async (
  orgId: string,
  scope: PromptScope,
  documentType: DocumentPromptType,
) => {
  await deleteItem(promptPkForScope(scope), buildDocumentPromptSk(orgId, documentType));
};