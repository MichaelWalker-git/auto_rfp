import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import {
  CreateFOIARequestSchema,
  calculateFOIADeadline,
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
    const validationResult = CreateFOIARequestSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const dto: CreateFOIARequest = validationResult.data;
    const userId = event.authContext?.userId || 'unknown';

    // Verify project has a LOST outcome
    const outcomeExists = await checkLostOutcome(dto.orgId, dto.projectId);
    if (!outcomeExists) {
      return apiResponse(400, {
        message: 'FOIA request can only be created for projects with LOST outcome',
      });
    }

    const foiaRequest = await createFOIARequest(dto, userId);

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

async function checkLostOutcome(orgId: string, projectId: string): Promise<boolean> {
  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROJECT_OUTCOME_PK,
      [SK_NAME]: `${orgId}#${projectId}`,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item?.status === 'LOST';
}

export async function createFOIARequest(
  dto: CreateFOIARequest,
  userId: string
): Promise<DBFOIARequestItem> {
  const {
    projectId,
    orgId,
    agencyName,
    agencyFOIAEmail,
    agencyFOIAAddress,
    solicitationNumber,
    contractNumber,
    requestedDocuments,
    customDocumentRequests,
    requesterName,
    requesterEmail,
    requesterPhone,
    requesterAddress,
    requesterCategory,
    feeLimit,
    requestFeeWaiver,
    feeWaiverJustification,
    notes,
  } = dto;

  const now = new Date().toISOString();
  const foiaId = uuidv4();

  // Calculate deadline (20 business days from submission)
  const deadlineDate = calculateFOIADeadline(new Date());
  const responseDeadline = deadlineDate.toISOString();

  // Create sort key: orgId#projectId#foiaId
  const sortKey = `${orgId}#${projectId}#${foiaId}`;

  const foiaItem: DBFOIARequestItem = {
    [PK_NAME]: FOIA_REQUEST_PK,
    [SK_NAME]: sortKey,
    foiaId,
    id: foiaId,
    projectId,
    orgId,
    status: 'DRAFT',
    agencyId: agencyName,
    agencyName,
    agencyFOIAEmail,
    agencyFOIAAddress,
    agencyAbbreviation: agencyName,
    contractTitle: solicitationNumber,
    contractNumber,
    solicitationNumber,
    requestedDocuments,
    customDocumentRequests,
    requesterCategory: requesterCategory || 'OTHER',
    feeLimit: feeLimit ?? 50,
    requestFeeWaiver: requestFeeWaiver ?? false,
    feeWaiverJustification,
    requesterName,
    requesterEmail,
    requesterPhone,
    requesterAddress,
    statusHistory: [
      {
        status: 'DRAFT',
        changedAt: now,
        changedBy: userId,
      },
    ],
    responseDeadline,
    autoSubmitAttempted: false,
    generatedLetterS3Key: '',
    generatedLetterVersion: 0,
    requestedBy: userId,
    notes,
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
    .use(httpErrorMiddleware())
);
