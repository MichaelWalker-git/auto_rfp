import { GetCommand, QueryCommand, UpdateCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { createItem, DBItem, docClient } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { CLARIFYING_QUESTION_PK } from '../constants/clarifying-question';
import { safeSplit } from './safe-string';
import { nowIso } from './date';

import type {
  ClarifyingQuestionItem,
  CreateClarifyingQuestionDTO,
  UpdateClarifyingQuestionDTO,
} from '@auto-rfp/core';

const DOCUMENTS_TABLE = requireEnv('DB_TABLE_NAME');

export type ClarifyingQuestionDBItem = ClarifyingQuestionItem & DBItem;

/**
 * Build sort key for clarifying question
 * Format: `${orgId}#${projectId}#${opportunityId}#${questionId}`
 */
export const buildClarifyingQuestionSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  questionId: string
) => `${orgId}#${projectId}#${opportunityId}#${questionId}`;

/**
 * Build sort key prefix for querying by opportunity
 */
export const buildClarifyingQuestionSkPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string
) => `${orgId}#${projectId}#${opportunityId}#`;

/**
 * Parse sort key to extract IDs
 */
export const parseClarifyingQuestionSk = (sk: string) => {
  const parts = safeSplit(sk, '#');
  return {
    orgId: parts[0] ?? '',
    projectId: parts[1] ?? '',
    opportunityId: parts[2] ?? '',
    questionId: parts[3] ?? '',
  };
};

/**
 * CREATE a single clarifying question
 */
export const createClarifyingQuestion = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  question: Omit<CreateClarifyingQuestionDTO, 'orgId' | 'projectId' | 'opportunityId'>;
}) => {
  const questionId = uuidv4();

  const item = await createItem<ClarifyingQuestionDBItem>(
    CLARIFYING_QUESTION_PK,
    buildClarifyingQuestionSk(args.orgId, args.projectId, args.opportunityId, questionId),
    {
      ...args.question,
      questionId,
      orgId: args.orgId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
    } as ClarifyingQuestionDBItem
  );

  return { item, questionId };
};

/**
 * CREATE multiple clarifying questions (batch)
 */
export const createClarifyingQuestionsBatch = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  questions: Array<Omit<CreateClarifyingQuestionDTO, 'orgId' | 'projectId' | 'opportunityId'>>;
}) => {
  const now = nowIso();
  const items: ClarifyingQuestionDBItem[] = [];

  for (const question of args.questions) {
    const questionId = uuidv4();
    items.push({
      [PK_NAME]: CLARIFYING_QUESTION_PK,
      [SK_NAME]: buildClarifyingQuestionSk(args.orgId, args.projectId, args.opportunityId, questionId),
      ...question,
      questionId,
      orgId: args.orgId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      createdAt: now,
      updatedAt: now,
    } as ClarifyingQuestionDBItem);
  }

  // BatchWriteCommand can handle up to 25 items at a time
  const chunks: ClarifyingQuestionDBItem[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    chunks.push(items.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [DOCUMENTS_TABLE]: chunk.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );
  }

  return { items, count: items.length };
};

/**
 * READ (by questionId)
 */
export const getClarifyingQuestion = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  questionId: string;
}) => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: CLARIFYING_QUESTION_PK,
        [SK_NAME]: buildClarifyingQuestionSk(
          args.orgId,
          args.projectId,
          args.opportunityId,
          args.questionId
        ),
      },
    })
  );

  const item = (res.Item as ClarifyingQuestionDBItem | undefined) ?? undefined;
  return item ? { item, questionId: args.questionId } : undefined;
};

/**
 * LIST (by opportunity)
 */
export const listClarifyingQuestionsByOpportunity = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  limit?: number;
  nextToken?: Record<string, unknown>;
}) => {
  const skPrefix = buildClarifyingQuestionSkPrefix(args.orgId, args.projectId, args.opportunityId);

  const res = await docClient.send(
    new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: `#pk = :pk AND begins_with(#sk, :skPrefix)`,
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': CLARIFYING_QUESTION_PK,
        ':skPrefix': skPrefix,
      },
      Limit: args.limit,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    })
  );

  const items = (res.Items as ClarifyingQuestionDBItem[]) ?? [];

  return {
    items,
    nextToken: res.LastEvaluatedKey ?? null,
  };
};

/**
 * UPDATE (partial)
 */
export const updateClarifyingQuestion = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  questionId: string;
  patch: UpdateClarifyingQuestionDTO;
}) => {
  const forbidden = new Set<string>([PK_NAME, SK_NAME, 'createdAt', 'updatedAt', 'questionId', 'orgId', 'projectId', 'opportunityId']);
  const patchEntries = Object.entries(args.patch).filter(
    ([k, v]) => !forbidden.has(k) && typeof v !== 'undefined'
  );

  const names: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
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
        [PK_NAME]: CLARIFYING_QUESTION_PK,
        [SK_NAME]: buildClarifyingQuestionSk(
          args.orgId,
          args.projectId,
          args.opportunityId,
          args.questionId
        ),
      },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: `attribute_exists(#pk) AND attribute_exists(#sk)`,
      ReturnValues: 'ALL_NEW',
    })
  );

  return { item: res.Attributes as ClarifyingQuestionDBItem, questionId: args.questionId };
};

/**
 * DELETE
 */
export const deleteClarifyingQuestion = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  questionId: string;
}) => {
  await docClient.send(
    new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        [PK_NAME]: CLARIFYING_QUESTION_PK,
        [SK_NAME]: buildClarifyingQuestionSk(
          args.orgId,
          args.projectId,
          args.opportunityId,
          args.questionId
        ),
      },
      ConditionExpression: `attribute_exists(#pk) AND attribute_exists(#sk)`,
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
    })
  );

  return { ok: true as const };
};

/**
 * Count questions by status for an opportunity
 */
export const countClarifyingQuestionsByStatus = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
}) => {
  const { items } = await listClarifyingQuestionsByOpportunity({
    orgId: args.orgId,
    projectId: args.projectId,
    opportunityId: args.opportunityId,
    limit: 1000, // Increase if needed
  });

  const counts = {
    total: items.length,
    suggested: 0,
    reviewed: 0,
    submitted: 0,
    answered: 0,
    dismissed: 0,
  };

  for (const item of items) {
    switch (item.status) {
      case 'SUGGESTED':
        counts.suggested++;
        break;
      case 'REVIEWED':
        counts.reviewed++;
        break;
      case 'SUBMITTED':
        counts.submitted++;
        break;
      case 'ANSWERED':
        counts.answered++;
        break;
      case 'DISMISSED':
        counts.dismissed++;
        break;
    }
  }

  return counts;
};
