import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { apiResponse, getOrgId } from '@/helpers/api';

import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  SYSTEM_PROMPT_PK, USER_PROMPT_PK,
  PROPOSAL_SYSTEM_PROMPT, PROPOSAL_USER_PROMPT,
  SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT,
  CONTACTS_SYSTEM_PROMPT, CONTACTS_USER_PROMPT,
  REQUIREMENTS_SYSTEM_PROMPT, REQUIREMENTS_USER_PROMPT,
  RISK_SYSTEM_PROMPT, RISK_USER_PROMPT,
  DEADLINE_SYSTEM_PROMPT, DEADLINE_USER_PROMPT,
  SCORING_SYSTEM_PROMPT, SCORING_USER_PROMPT,
  ANSWER_SYSTEM_PROMPT, ANSWER_USER_PROMPT,
} from '@/constants/prompt';

import { withSentryLambda } from '../../sentry-lambda';
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

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { ok: false, error: 'Missing required orgId' });
  }

  const [systemFromDb, userFromDb] = await Promise.all([
    queryPromptsByPkForOrg(SYSTEM_PROMPT_PK, orgId),
    queryPromptsByPkForOrg(USER_PROMPT_PK, orgId),
  ]);

  // Default prompts for each known type
  const defaultSystemPrompts: Record<string, string> = {
    PROPOSAL: PROPOSAL_SYSTEM_PROMPT,
    SUMMARY: SUMMARY_SYSTEM_PROMPT,
    CONTACTS: CONTACTS_SYSTEM_PROMPT,
    REQUIREMENTS: REQUIREMENTS_SYSTEM_PROMPT,
    RISK: RISK_SYSTEM_PROMPT,
    DEADLINE: DEADLINE_SYSTEM_PROMPT,
    SCORING: SCORING_SYSTEM_PROMPT,
    ANSWER: ANSWER_SYSTEM_PROMPT,
  };

  const defaultUserPrompts: Record<string, string> = {
    PROPOSAL: PROPOSAL_USER_PROMPT,
    SUMMARY: SUMMARY_USER_PROMPT,
    CONTACTS: CONTACTS_USER_PROMPT,
    REQUIREMENTS: REQUIREMENTS_USER_PROMPT,
    RISK: RISK_USER_PROMPT,
    DEADLINE: DEADLINE_USER_PROMPT,
    SCORING: SCORING_USER_PROMPT,
    ANSWER: ANSWER_USER_PROMPT,
  };

  // Merge: for each known type, if not in DB, add a default entry
  const systemTypes = new Set((systemFromDb ?? []).map((p: any) => p.type));
  const userTypes = new Set((userFromDb ?? []).map((p: any) => p.type));

  const system = [...(systemFromDb ?? [])];
  const user = [...(userFromDb ?? [])];

  for (const [type, prompt] of Object.entries(defaultSystemPrompts)) {
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

  for (const [type, prompt] of Object.entries(defaultUserPrompts)) {
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

  return apiResponse(200, {
    ok: true,
    items: { system, user },
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('prompt:read'))
    .use(httpErrorMiddleware()),
);