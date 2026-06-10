import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import {
  CreateDebriefingRequestSchema,
} from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DEBRIEFING_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { getOpportunity } from '@/helpers/opportunity';
import type { DBDebriefingItem } from '@/types/project-outcome';
import type { CreateDebriefingRequest } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

interface AuthContext {
  userId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2 & { authContext?: AuthContext }
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data: dto, error } = CreateDebriefingRequestSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const userId = event.authContext?.userId || 'unknown';

    // Verify the specific opportunity has a LOST outcome and is a federal contract.
    const oppResult = await getOpportunity({ orgId: dto.orgId, projectId: dto.projectId, oppId: dto.opportunityId });
    const outcome = oppResult?.item;
    if (outcome?.status !== 'LOST') {
      return apiResponse(400, {
        message: 'Debriefing can only be requested for projects with LOST outcome',
      });
    }

    // Debriefings are a federal procurement mechanism — not available for state contracts.
    if (outcome.jurisdiction === 'STATE') {
      return apiResponse(400, {
        message: 'Debriefings are only available for federal contracts. For state contracts, use a public records request instead.',
      });
    }

    const debriefing = await createDebriefing(dto, userId);


    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'debriefing',
    });

    return apiResponse(201, { debriefing });
  } catch (err: unknown) {
    console.error('Error in createDebriefing handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const createDebriefing = async (
  dto: CreateDebriefingRequest,
  userId: string
): Promise<DBDebriefingItem> => {
  const {
    projectId,
    orgId,
    opportunityId,
    solicitationNumber,

    contractTitle,
    awardedOrganization,
    awardNotificationDate,
    contractingOfficerName,
    contractingOfficerEmail,
    requesterName,
    requesterTitle,
    requesterEmail,
    requesterPhone,
    requesterAddress,
    companyName,
  } = dto;

  const now = new Date().toISOString();
  const debriefId = uuidv4();

  // Create sort key: orgId#projectId#opportunityId#debriefingId
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${debriefId}`;

  const debriefingItem: DBDebriefingItem = {
    [PK_NAME]: DEBRIEFING_PK,
    [SK_NAME]: sortKey,
    debriefId,
    projectId,
    orgId,
    opportunityId,
    solicitationNumber,

    contractTitle,
    awardedOrganization,
    awardNotificationDate,
    contractingOfficerName,
    contractingOfficerEmail,
    requesterName,
    requesterTitle,
    requesterEmail,
    requesterPhone,
    requesterAddress,
    companyName,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  };

  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: debriefingItem,
  });

  await docClient.send(cmd);

  return debriefingItem;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
