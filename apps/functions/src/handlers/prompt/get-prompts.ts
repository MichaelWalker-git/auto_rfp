import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { apiResponse, getOrgId } from '@/helpers/api';

import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  SYSTEM_PROMPT_PK, USER_PROMPT_PK,
  SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT,
  CONTACTS_SYSTEM_PROMPT, CONTACTS_USER_PROMPT,
  REQUIREMENTS_SYSTEM_PROMPT, REQUIREMENTS_USER_PROMPT,
  RISK_SYSTEM_PROMPT, RISK_USER_PROMPT,
  DEADLINE_SYSTEM_PROMPT, DEADLINE_USER_PROMPT,
  SCORING_SYSTEM_PROMPT, SCORING_USER_PROMPT,
  ANSWER_SYSTEM_PROMPT, ANSWER_USER_PROMPT,
  CLARIFYING_QUESTIONS_SYSTEM_PROMPT, CLARIFYING_QUESTIONS_USER_PROMPT,
} from '@/constants/prompt';
import {
  type DocumentPromptItem,
  DocumentPromptTypeSchema,
  type PromptItem,
  type PromptType,
} from '@auto-rfp/core';
import { getDefaultGuidance, getDefaultTask } from '@/helpers/document-prompts';

/** A queried prompt row: legacy feature prompt or document-generation override. */
type PromptRow = PromptItem | DocumentPromptItem;

/** Response rows may be synthesized defaults, marked with isDefault. */
type MergedPromptItem = PromptItem & { isDefault?: boolean };

const isDocumentRow = (p: PromptRow): p is DocumentPromptItem =>
  typeof (p as DocumentPromptItem).documentType === 'string';

import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function queryPromptsByPkForOrg(pkValue: string, orgId: string) {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    try {
      const res: any = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#sk': SK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': pkValue,
            ':skPrefix': `${orgId}#`,
          },
          ExclusiveStartKey,
        }),
      );

      if (Array.isArray(res?.Items) && res.Items.length) items.push(...res.Items);
      ExclusiveStartKey = res?.LastEvaluatedKey;
    } catch (e: any) {
      console.error('DDB Query failed', {
        message: e?.message,
        name: e?.name,
        pkValue,
        orgId,
        table: DB_TABLE_NAME,
      });
      throw e;
    }
  } while (ExclusiveStartKey);

  return items;
}

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { ok: false, error: 'Missing required orgId' });
  }

  const [systemFromDb, userFromDb] = await Promise.all([
    queryPromptsByPkForOrg(SYSTEM_PROMPT_PK, orgId),
    queryPromptsByPkForOrg(USER_PROMPT_PK, orgId),
  ]);

  // Default prompts for each known type
  // (PROPOSAL intentionally not synthesized — dead type, kept only for data compat)
  const defaultSystemPrompts: Partial<Record<PromptType, string>> = {
    SUMMARY: SUMMARY_SYSTEM_PROMPT,
    CONTACTS: CONTACTS_SYSTEM_PROMPT,
    REQUIREMENTS: REQUIREMENTS_SYSTEM_PROMPT,
    RISK: RISK_SYSTEM_PROMPT,
    DEADLINE: DEADLINE_SYSTEM_PROMPT,
    SCORING: SCORING_SYSTEM_PROMPT,
    ANSWER: ANSWER_SYSTEM_PROMPT,
    CLARIFYING_QUESTIONS: CLARIFYING_QUESTIONS_SYSTEM_PROMPT,
  };

  const defaultUserPrompts: Partial<Record<PromptType, string>> = {
    SUMMARY: SUMMARY_USER_PROMPT,
    CONTACTS: CONTACTS_USER_PROMPT,
    REQUIREMENTS: REQUIREMENTS_USER_PROMPT,
    RISK: RISK_USER_PROMPT,
    DEADLINE: DEADLINE_USER_PROMPT,
    SCORING: SCORING_USER_PROMPT,
    ANSWER: ANSWER_USER_PROMPT,
    CLARIFYING_QUESTIONS: CLARIFYING_QUESTIONS_USER_PROMPT,
  };

  // Split queried rows: document prompt overrides (3-segment SK, carry a
  // documentType attribute) vs legacy feature prompts.
  const systemRows = (systemFromDb ?? []) as PromptRow[];
  const userRows = (userFromDb ?? []) as PromptRow[];

  const systemFeatureRows = systemRows.filter((p): p is PromptItem => !isDocumentRow(p));
  const userFeatureRows = userRows.filter((p): p is PromptItem => !isDocumentRow(p));
  const documentRows: DocumentPromptItem[] = [
    ...systemRows.filter(isDocumentRow),
    ...userRows.filter(isDocumentRow),
  ];

  // Merge: for each known type, if not in DB, add a default entry
  const systemTypes = new Set(systemFeatureRows.map((p) => p.type));
  const userTypes = new Set(userFeatureRows.map((p) => p.type));

  const system: MergedPromptItem[] = [...systemFeatureRows];
  const user: MergedPromptItem[] = [...userFeatureRows];

  for (const [type, prompt] of Object.entries(defaultSystemPrompts) as [PromptType, string][]) {
    if (!systemTypes.has(type)) {
      system.push({
        type,
        scope: 'SYSTEM',
        prompt,
        params: [],
        isDefault: true,
      });
    }
  }

  for (const [type, prompt] of Object.entries(defaultUserPrompts) as [PromptType, string][]) {
    if (!userTypes.has(type)) {
      user.push({
        type,
        scope: 'USER',
        prompt,
        params: [],
        isDefault: true,
      });
    }
  }

  // Document prompts: synthesize defaults for every overridable type × scope
  // not present in the DB (same isDefault pattern as feature prompts).
  const overriddenDocKeys = new Set(
    documentRows.map((p) => `${p.scope}#${p.documentType}`),
  );

  const document: DocumentPromptItem[] = [...documentRows];
  for (const documentType of DocumentPromptTypeSchema.options) {
    if (!overriddenDocKeys.has(`SYSTEM#${documentType}`)) {
      document.push({
        documentType,
        scope: 'SYSTEM',
        prompt: getDefaultGuidance(documentType),
        isDefault: true,
      });
    }
    if (!overriddenDocKeys.has(`USER#${documentType}`)) {
      document.push({
        documentType,
        scope: 'USER',
        prompt: getDefaultTask(documentType),
        isDefault: true,
      });
    }
  }

  return apiResponse(200, {
    ok: true,
    items: { system, user, document },
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('prompt:read'))
    .use(httpErrorMiddleware()),
);