import { docClient } from './db';
import { requireEnv } from './env';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { nowIso } from './date';
import { SYSTEM_PROMPT_PK, USER_PROMPT_PK } from '../constants/prompt';
import { PromptItem, PromptType } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const savePrompt = async (orgId: string, type: PromptType, prompt: string, pk: string,   params: string[] = []) => {
  const res = await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: `${orgId}#${type}`,
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
        [SK_NAME]: `${orgId}#${type}`,
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