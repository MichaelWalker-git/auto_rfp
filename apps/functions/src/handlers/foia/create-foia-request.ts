import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import {
  CreateFOIARequestSchema,
  type CreateFOIARequest,
} from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK, PROJECT_OUTCOME_PK } from '@/constants/organization';
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
import type { DBFOIARequestItem } from '@/types/project-outcome';

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
    const { success, data: dto, error } = CreateFOIARequestSchema.safeParse(rawBody);

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

    // Verify the specific opportunity has a LOST outcome
    const outcomeExists = await checkLostOutcome(dto.orgId, dto.projectId, dto.opportunityId);
    if (!outcomeExists) {
      return apiResponse(400, {
        message: 'FOIA request can only be created for projects with LOST outcome',
      });
    }

    const foiaRequest = await createFOIARequest(dto, userId);

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'foia-request',
    });

    return apiResponse(201, { foiaRequest });
  } catch (err: unknown) {
    console.error('Error in createFOIARequest handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function checkLostOutcome(orgId: string, projectId: string, opportunityId: string): Promise<boolean> {
  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROJECT_OUTCOME_PK,
      [SK_NAME]: `${orgId}#${projectId}#${opportunityId}`,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item?.status === 'LOST';
}

export async function createFOIARequest(
  dto: CreateFOIARequest,
  userId: string
): Promise<DBFOIARequestItem> {
  const now = new Date().toISOString();
  const foiaId = uuidv4();

  // Create sort key: orgId#projectId#opportunityId#foiaId
  const sortKey = `${dto.orgId}#${dto.projectId}#${dto.opportunityId}#${foiaId}`;

  const foiaItem: DBFOIARequestItem = {
    [PK_NAME]: FOIA_REQUEST_PK,
    [SK_NAME]: sortKey,
    foiaId,
    id: foiaId,
    projectId: dto.projectId,
    orgId: dto.orgId,
    opportunityId: dto.opportunityId,
    agencyName: dto.agencyName,
    agencyFOIAEmail: dto.agencyFOIAEmail,
    agencyFOIAAddress: dto.agencyFOIAAddress,
    solicitationNumber: dto.solicitationNumber,
    contractTitle: dto.contractTitle,
    requestedDocuments: dto.requestedDocuments,
    customDocumentRequests: dto.customDocumentRequests ?? [],
    feeLimit: dto.feeLimit ?? 0,
    companyName: dto.companyName,
    awardeeName: dto.awardeeName,
    awardDate: dto.awardDate,
    requesterName: dto.requesterName,
    requesterTitle: dto.requesterTitle,
    requesterEmail: dto.requesterEmail,
    requesterPhone: dto.requesterPhone,
    requesterAddress: dto.requesterAddress,
    requestedBy: userId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  };

  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: foiaItem,
  });

  await docClient.send(cmd);

  return foiaItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
